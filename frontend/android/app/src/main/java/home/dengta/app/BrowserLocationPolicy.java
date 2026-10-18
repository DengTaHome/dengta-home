package home.dengta.app;

import java.net.URI;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class BrowserLocationPolicy {
    private static final String[] DOMAINS = {"ele.me", "taobao.com", "tmall.com"};
    static final Set<String> ORIGIN_RULES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "https://ele.me", "https://*.ele.me", "https://taobao.com", "https://*.taobao.com", "https://tmall.com", "https://*.tmall.com")));

    private static URI trusted(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null ||
                uri.getPort() != -1 && uri.getPort() != 443) return null;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            for (String domain : DOMAINS) if (host.equals(domain) || host.endsWith("." + domain)) return uri;
        } catch (Exception ignored) {}
        return null;
    }
    static boolean isTrustedPage(String url) { return trusted(url) != null; }
    static boolean mayGrant(String topUrl, String requestOrigin, boolean systemGranted) {
        if (!systemGranted) return false;
        URI top = trusted(topUrl), origin = trusted(requestOrigin);
        if (top == null || origin == null || origin.getRawQuery() != null || origin.getRawFragment() != null ||
            origin.getRawPath() != null && !origin.getRawPath().isEmpty() && !"/".equals(origin.getRawPath())) return false;
        return top.getHost().equalsIgnoreCase(origin.getHost());
    }
    static boolean mayReadBridge(String topUrl, String requestOrigin, boolean mainFrame, boolean systemGranted) {
        return mainFrame && mayGrant(topUrl, requestOrigin, systemGranted);
    }
}
