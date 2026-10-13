package home.dengta.app;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import static org.junit.Assert.*;

public class CastHlsProxyTest {
    private ServerSocket server;
    private Thread thread;
    private LocalMediaProxy proxy;
    private final Map<String, String> responses = new ConcurrentHashMap<>();
    private final Map<String, String> ranges = new ConcurrentHashMap<>();
    private final AtomicInteger calls = new AtomicInteger();

    @Before public void start() throws Exception {
        server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        thread = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket client = server.accept()) {
                    client.setSoTimeout(2000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                    String request = reader.readLine();
                    String path = request.split(" ")[1], header;
                    while ((header = reader.readLine()) != null && !header.isEmpty()) {
                        if (header.toLowerCase(java.util.Locale.ROOT).startsWith("range:")) ranges.put(path, header.substring(6).trim());
                    }
                    calls.incrementAndGet();
                    String response = responses.getOrDefault(path, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                    client.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
                    client.getOutputStream().flush();
                } catch (Exception ignored) { }
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    @After public void stop() throws Exception {
        if (proxy != null) proxy.stop();
        server.close();
        thread.join(2500);
    }

    private void resource(String path, String type, String body) {
        responses.put(path, "HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\nContent-Length: "
            + body.getBytes(StandardCharsets.UTF_8).length + "\r\nConnection: close\r\n\r\n" + body);
    }
    private void launch(String path) {
        proxy = LocalMediaProxy.startRandom("http://127.0.0.1:" + server.getLocalPort() + path);
        assertNotNull(proxy);
    }
    private String get(String url, int status, String range) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(2000);
        connection.setReadTimeout(2000);
        if (range != null) connection.setRequestProperty("Range", range);
        try {
            assertEquals(status, connection.getResponseCode());
            try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                byte[] body = input.readAllBytes();
                if (status == 200) assertEquals(body.length, connection.getContentLength());
                return new String(body, StandardCharsets.UTF_8);
            }
        } finally { connection.disconnect(); }
    }
    private String lineUri(String playlist) {
        for (String line : playlist.split("\n")) if (!line.isEmpty() && !line.startsWith("#")) return line;
        throw new AssertionError("missing playlist resource");
    }
    private String tagUri(String playlist, String tag) {
        Matcher match = Pattern.compile(Pattern.quote(tag) + ":[^\n]*?URI=\"([^\"]+)\"").matcher(playlist);
        assertTrue(match.find()); return match.group(1);
    }

    @Test public void redirectedMasterMediaKeyAndMapAllUseRegisteredLocalRoutes() throws Exception {
        responses.put("/entry.m3u8", "HTTP/1.1 302 Found\r\nLocation: /folder/master.m3u8\r\nContent-Length: 0\r\n\r\n");
        resource("/folder/master.m3u8", "application/vnd.apple.mpegurl", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvideo/list.m3u8?token=a%2Fb\n");
        resource("/folder/video/list.m3u8?token=a%2Fb", "audio/mpegurl", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST\n");
        resource("/folder/key.bin", "application/octet-stream", "dummy-key");
        resource("/folder/video/init.mp4", "application/octet-stream", "init");
        resource("/folder/video/segment.ts", "video/mp2t", "segment");
        launch("/entry.m3u8");
        String master = get(proxy.getProxyUrl(), 200, null);
        String media = get(lineUri(master), 200, null);
        assertFalse(media.contains("token="));
        assertEquals("dummy-key", get(tagUri(media, "#EXT-X-KEY"), 200, null));
        assertEquals("init", get(tagUri(media, "#EXT-X-MAP"), 200, null));
        assertEquals("segment", get(lineUri(media), 200, null));
        assertEquals(lineUri(master), lineUri(get(proxy.getProxyUrl(), 200, null)));
        int before = calls.get();
        get(lineUri(media) + "?url=http://example.invalid", 404, null);
        assertEquals(before, calls.get());
    }

    @Test public void contentTypeOnlyPlaylistAndRangeRedirectsAreSupported() throws Exception {
        resource("/playlist", "application/vnd.apple.mpegurl; charset=utf-8", "#EXTM3U\n#EXTINF:1,\nrange\n");
        responses.put("/range", "HTTP/1.1 307 Temporary Redirect\r\nLocation: bytes\r\nContent-Length: 0\r\n\r\n");
        responses.put("/bytes", "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 2-3/4\r\nContent-Length: 2\r\n\r\n23");
        launch("/playlist");
        String media = get(proxy.getProxyUrl(), 200, null);
        assertEquals("23", get(lineUri(media), 206, "bytes=2-3"));
        assertEquals("bytes=2-3", ranges.get("/range"));
        assertEquals("bytes=2-3", ranges.get("/bytes"));
    }

    @Test public void redirectLoopAndNonHttpRedirectsFailWithoutAnUnboundedLoop() throws Exception {
        responses.put("/loop", "HTTP/1.1 302 Found\r\nLocation: loop\r\nContent-Length: 0\r\n\r\n");
        launch("/loop");
        get(proxy.getProxyUrl(), 502, null);
        assertEquals(6, calls.get());
        responses.put("/loop", "HTTP/1.1 302 Found\r\nLocation: file:///private\r\nContent-Length: 0\r\n\r\n");
        get(proxy.getProxyUrl(), 502, null);
        assertEquals(7, calls.get());
    }

    @Test public void oversizedAndInvalidPlaylistsNeverReturnSuccess() throws Exception {
        responses.put("/large.m3u8", "HTTP/1.1 200 OK\r\nContent-Length: 1048577\r\n\r\n");
        launch("/large.m3u8");
        get(proxy.getProxyUrl(), 502, null);
        resource("/large.m3u8", "application/vnd.apple.mpegurl", "<html>upstream error</html>");
        get(proxy.getProxyUrl(), 502, null);
        resource("/large.m3u8", "application/vnd.apple.mpegurl", "#EXTM3U\n{$missing}/segment.ts\n");
        get(proxy.getProxyUrl(), 502, null);
        responses.put("/large.m3u8", "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n#EXTM3U\nsegment.ts\n");
        get(proxy.getProxyUrl(), 502, null);
        responses.put("/large.m3u8", "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n#EXTM3U\n" + new String(new char[1048577]).replace('\0', 'x'));
        get(proxy.getProxyUrl(), 502, null);
    }

    @Test public void liveReloadPublishesNewSegmentsAndKeepsExistingRoutesStable() throws Exception {
        resource("/live.m3u8", "audio/mpegurl", "#EXTM3U\n#EXTINF:1,\none.ts\n");
        resource("/one.ts", "video/mp2t", "one");
        resource("/two.ts", "video/mp2t", "two");
        launch("/live.m3u8");
        String first = lineUri(get(proxy.getProxyUrl(), 200, null));
        resource("/live.m3u8", "audio/mpegurl", "#EXTM3U\n#EXTINF:1,\ntwo.ts\n");
        String second = lineUri(get(proxy.getProxyUrl(), 200, null));
        assertNotEquals(first, second);
        assertEquals("one", get(first, 200, null));
        assertEquals("two", get(second, 200, null));
        assertEquals(second, lineUri(get(proxy.getProxyUrl(), 200, null)));
    }

    @Test public void brokenBinaryChunkDoesNotAppendASecondHttpResponse() throws Exception {
        responses.put("/broken", "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\nZ\r\n");
        launch("/broken");
        try (Socket client = new Socket("127.0.0.1", proxy.getPort())) {
            client.setSoTimeout(2000);
            client.getOutputStream().write(("GET " + new URL(proxy.getProxyUrl()).getPath() + " HTTP/1.1\r\nHost: localhost\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            client.getOutputStream().flush();
            String result = new String(client.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(result.startsWith("HTTP/1.1 200 OK"));
            assertEquals(1, result.split("HTTP/1.1", -1).length - 1);
            assertFalse(result.contains("Media request failed"));
        }
    }
}
