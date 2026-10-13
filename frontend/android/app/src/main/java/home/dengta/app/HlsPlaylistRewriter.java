package home.dengta.app;

import java.io.IOException;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class HlsPlaylistRewriter {
    interface UrlMapper { String map(String url) throws IOException; }
    private static final Pattern ATTRIBUTE = Pattern.compile("(?:^|,)([A-Z0-9-]+)=(\"[^\"]*\"|[^,]*)");

    static String rewrite(String playlist, URL base, UrlMapper mapper) throws IOException {
        if (!(playlist.startsWith("#EXTM3U\n") || playlist.startsWith("#EXTM3U\r\n"))) {
            throw new IOException("invalid_hls_playlist");
        }
        String[] lines = playlist.split("\n", -1);
        int references = 0;
        for (int i = 0; i < lines.length; i++) {
            boolean cr = lines[i].endsWith("\r");
            String line = cr ? lines[i].substring(0, lines[i].length() - 1) : lines[i];
            if (!line.isEmpty() && !line.startsWith("#")) {
                if (++references > 4096) throw new IOException("hls_too_many_references");
                line = rewriteUri(line, base, mapper, false);
            } else if (line.startsWith("#EXT-X-")) {
                int colon = line.indexOf(':');
                if (colon >= 0) {
                    String attributes = line.substring(colon + 1);
                    Matcher matcher = ATTRIBUTE.matcher(attributes);
                    StringBuilder result = new StringBuilder();
                    int copied = 0;
                    while (matcher.find()) {
                        if (!"URI".equals(matcher.group(1))) continue;
                        if (++references > 4096) throw new IOException("hls_too_many_references");
                        String value = matcher.group(2);
                        if (value.length() < 2 || !value.startsWith("\"") || !value.endsWith("\"")) throw new IOException("invalid_hls_uri");
                        result.append(attributes, copied, matcher.start(2));
                        boolean keyIdentifier = line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:");
                        result.append('"').append(rewriteUri(value.substring(1, value.length() - 1), base, mapper, keyIdentifier)).append('"');
                        copied = matcher.end(2);
                    }
                    line = line.substring(0, colon + 1) + result.append(attributes.substring(copied));
                }
            }
            lines[i] = line + (cr ? "\r" : "");
        }
        return String.join("\n", lines);
    }

    private static String rewriteUri(String reference, URL base, UrlMapper mapper, boolean keyIdentifier) throws IOException {
        if (reference.isEmpty() || reference.contains("{$")) throw new IOException("unsupported_hls_uri");
        // Non-HTTP key identifiers belong to the player's existing DRM implementation.
        if (reference.matches("^[A-Za-z][A-Za-z0-9+.-]*:.*")
                && !reference.regionMatches(true, 0, "http:", 0, 5)
                && !reference.regionMatches(true, 0, "https:", 0, 6)) {
            if (keyIdentifier && reference.matches("(?i)^(skd|data|urn):.*")) return reference;
            throw new IOException("unsupported_hls_uri");
        }
        URL resolved = new URL(base, reference);
        if (!("http".equals(resolved.getProtocol()) || "https".equals(resolved.getProtocol()))) throw new IOException("unsupported_hls_uri");
        return mapper.map(resolved.toExternalForm());
    }

    private HlsPlaylistRewriter() {}
}
