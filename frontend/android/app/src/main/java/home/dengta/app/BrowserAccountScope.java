package home.dengta.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Process-local authority: exported intents cannot select an account's browser profile. */
final class BrowserAccountScope {
    static final class Binding {
        final String profile;
        final long revision;
        Binding(String profile, long revision) { this.profile = profile; this.revision = revision; }
    }

    private static final class Ticket {
        final Binding binding;
        final long createdAt;
        final boolean restoration;
        Ticket(Binding binding, long createdAt, boolean restoration) { this.binding = binding; this.createdAt = createdAt; this.restoration = restoration; }
    }

    private final java.util.function.LongSupplier clock;
    BrowserAccountScope() { this(System::nanoTime); }
    BrowserAccountScope(java.util.function.LongSupplier clock) { this.clock = clock; }

    private String profile = "";
    private long revision;
    private final LinkedHashMap<String, Ticket> tickets = new LinkedHashMap<>();
    private final Set<Runnable> listeners = new LinkedHashSet<>();

    static String profileName(String account) {
        String normalized = account == null ? "" : account.trim().toLowerCase(Locale.ROOT);
        if (!normalized.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) {
            throw new IllegalArgumentException("browser_account_required");
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(("dengta-browser-v1:" + normalized).getBytes(StandardCharsets.UTF_8));
            StringBuilder key = new StringBuilder("dengta_account_");
            for (byte value : digest) key.append(String.format(Locale.ROOT, "%02x", value & 255));
            return key.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    synchronized boolean bind(String account) {
        String next = account == null || account.trim().isEmpty() ? "" : profileName(account);
        if (next.equals(profile)) return false;
        profile = next;
        revision++;
        tickets.clear();
        for (Runnable listener : new ArrayList<>(listeners)) {
            try { listener.run(); } catch (RuntimeException ignored) {}
        }
        return true;
    }

    synchronized Binding capture(String account) {
        String expected = profileName(account);
        if (profile.isEmpty() || !profile.equals(expected)) throw new IllegalStateException("browser_account_changed");
        return new Binding(profile, revision);
    }

    synchronized boolean isCurrent(Binding binding) {
        return binding != null && !profile.isEmpty() && profile.equals(binding.profile) && revision == binding.revision;
    }

    synchronized void requireCurrent(Binding binding) {
        if (!isCurrent(binding)) throw new IllegalStateException("browser_account_changed");
    }

    synchronized String issue(Binding binding) {
        return issue(binding, false);
    }

    synchronized String issueRestoration(Binding binding) {
        return issue(binding, true);
    }

    private String issue(Binding binding, boolean restoration) {
        requireCurrent(binding);
        while (tickets.size() >= 64) tickets.remove(tickets.keySet().iterator().next());
        String token = UUID.randomUUID().toString();
        tickets.put(token, new Ticket(binding, clock.getAsLong(), restoration));
        return token;
    }

    synchronized Binding consume(String token) {
        return consume(token, false);
    }

    synchronized Binding restore(String token) {
        return consume(token, true);
    }

    private Binding consume(String token, boolean restoration) {
        Ticket ticket = token == null ? null : tickets.remove(token);
        long age = ticket == null ? -1 : clock.getAsLong() - ticket.createdAt;
        long lifetime = restoration ? 43_200_000_000_000L : 60_000_000_000L;
        if (ticket == null || ticket.restoration != restoration || age < 0 || age > lifetime || !isCurrent(ticket.binding)) return null;
        return ticket.binding;
    }

    synchronized void addListener(Runnable listener) { listeners.add(listener); }
    synchronized void removeListener(Runnable listener) { listeners.remove(listener); }

    static String storageKey(Binding binding, String site) {
        if (binding == null) throw new IllegalStateException("browser_account_required");
        String name = site == null || site.isEmpty() ? "custom" : site.toLowerCase(Locale.ROOT);
        if ("xiaohongshu".equals(name)) name = "xhs";
        if (!name.matches("[a-z0-9_-]{1,32}")) throw new IllegalArgumentException("browser_site_invalid");
        return binding.profile + ":" + name;
    }
}
