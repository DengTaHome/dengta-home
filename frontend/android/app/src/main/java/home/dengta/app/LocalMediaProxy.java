package home.dengta.app;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.HashSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * 本地媒体代理 HTTP 服务器（Castor deliver 模式，多平台兼容）。
 *
 * 原理：视频网站 CDN 需要特定 Referer + User-Agent 才能下载。
 * 本代理仅在回环地址监听，只转发指定媒体和其 HLS 清单中登记的资源。
 * 代理从 CDN 拉流（带站点特定 headers）后透传回 ExoPlayer。
 *
 * 支持：B站 / 爱奇艺 / 腾讯视频 / 通用
 */
public final class LocalMediaProxy {

    private static final int BUFFER_SIZE = 8192;
    private static final int MAX_PLAYLIST_BYTES = 1024 * 1024;
    private static final int MAX_MEDIA_ROUTES = 8192;

    private final int port;
    private final ServerSocket serverSocket;
    private final Thread serverThread;
    private final String targetUrl;
    private final String requestPath;
    private final HashMap<String, String> mediaTargets = new HashMap<>();
    private final LinkedHashMap<String, String> mediaPaths = new LinkedHashMap<>(16, 0.75f, true);
    private final Set<Socket> clients = new HashSet<>();
    private final Set<HttpURLConnection> upstreams = new HashSet<>();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(2), task -> {
            Thread thread = new Thread(task, "local-media-stream");
            thread.setDaemon(true);
            return thread;
        });
    private volatile boolean running = false;

    private LocalMediaProxy(ServerSocket serverSocket, String targetUrl) {
        this.serverSocket = serverSocket;
        this.port = serverSocket.getLocalPort();
        this.targetUrl = targetUrl;
        String lower = targetUrl.toLowerCase(Locale.ROOT);
        this.requestPath = "/proxy/" + UUID.randomUUID() + (lower.contains("m3u8") || lower.contains("hls") ? "/stream.m3u8" : "/stream");
        mediaTargets.put(requestPath, targetUrl);
        this.serverThread = new Thread(this::serve, "local-media-proxy");
        serverThread.setDaemon(true);
    }

    /** 返回可关闭的代理实例；拖动进度可再次连接，同一时刻最多处理两个请求。 */
    public static LocalMediaProxy startRandom(String targetUrl) {
        ServerSocket ss = null;
        try {
            URL target = new URL(targetUrl);
            if (!("http".equals(target.getProtocol()) || "https".equals(target.getProtocol())) || target.getHost().isEmpty()) return null;
            ss = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            LocalMediaProxy proxy = new LocalMediaProxy(ss, targetUrl);
            proxy.running = true;
            proxy.serverThread.start();
            return proxy;
        } catch (Exception ignored) {
            if (ss != null) try { ss.close(); } catch (IOException ignoredClose) {}
            return null;
        }
    }

    public void stop() {
        Socket[] openClients;
        HttpURLConnection[] openUpstreams;
        synchronized (this) {
            running = false;
            openClients = clients.toArray(new Socket[0]);
            openUpstreams = upstreams.toArray(new HttpURLConnection[0]);
            clients.clear();
            upstreams.clear();
            mediaTargets.clear();
            mediaPaths.clear();
        }
        try { serverSocket.close(); } catch (IOException ignored) {}
        workers.shutdownNow();
        for (Socket client : openClients) closeClient(client);
        if (openUpstreams.length > 0) {
            // Some HTTP implementations wait for a blocked read inside disconnect().
            Thread cleanup = new Thread(() -> {
                for (HttpURLConnection upstream : openUpstreams) {
                    try { upstream.disconnect(); } catch (Exception ignored) {}
                }
            }, "local-media-close");
            cleanup.setDaemon(true);
            cleanup.start();
        }
    }

    public int getPort() { return port; }

    public String getProxyUrl() { return "http://127.0.0.1:" + port + requestPath; }

    private synchronized String registerMediaUrl(String url) throws IOException {
        if (!running) throw new IOException("proxy_stopped");
        if (url.length() > 8192) throw new IOException("hls_uri_too_long");
        if (url.equals(targetUrl)) return getProxyUrl();
        String path = mediaPaths.get(url);
        if (path == null) {
            if (mediaPaths.size() >= MAX_MEDIA_ROUTES) {
                String oldest = mediaPaths.keySet().iterator().next();
                mediaTargets.remove(mediaPaths.remove(oldest));
            }
            path = "/proxy/" + UUID.randomUUID() + (isPlaylist(new URL(url), null) ? "/stream.m3u8" : "/stream");
            mediaPaths.put(url, path);
            mediaTargets.put(path, url);
        }
        return "http://127.0.0.1:" + port + path;
    }

    private void closeClient(Socket client) {
        synchronized (this) { clients.remove(client); }
        try { client.close(); } catch (IOException ignored) {}
    }

    private void serve() {
        try (ServerSocket ss = serverSocket) {
            while (running) {
                try {
                    Socket client = ss.accept();
                    synchronized (this) {
                        if (!running) { client.close(); break; }
                        clients.add(client);
                    }
                    try { workers.execute(() -> handleClient(client)); }
                    catch (RejectedExecutionException ignored) { closeClient(client); }
                } catch (IOException ignored) {
                    break;
                }
            }
        } catch (Exception ignored) {}
        finally { stop(); }
    }

    private void handleClient(Socket client) {
        InputStream clientIn = null;
        OutputStream clientOut = null;
        try {
            clientIn = client.getInputStream();
            clientOut = client.getOutputStream();
            client.setSoTimeout(30000);

            StringBuilder requestLine = new StringBuilder();
            int c;
            while ((c = clientIn.read()) != -1 && c != '\n' && requestLine.length() < 2048) {
                requestLine.append((char) c);
            }
            String line = requestLine.toString().trim();
            if (!line.startsWith("GET ")) {
                writeError(clientOut, 400, "Bad Request");
                return;
            }

            int httpEnd = line.lastIndexOf(" HTTP");
            if (httpEnd < 0) {
                writeError(clientOut, 400, "Bad Request");
                return;
            }
            String path = line.substring(4, httpEnd);
            String requestedTarget;
            synchronized (this) {
                requestedTarget = mediaTargets.get(path);
                if (requestedTarget != null) mediaPaths.get(requestedTarget);
            }
            if (requestedTarget == null) {
                writeError(clientOut, 404, "Not Found");
                return;
            }

            // 读取请求头，提取 Range（ExoPlayer seek 依赖；CDN 需要转发才能返回 206）
            String rangeHeader = null;
            String headerLine;
            int headerBytes = 0;
            while (headerBytes < 8192) {
                StringBuilder hb = new StringBuilder();
                int hc;
                while ((hc = clientIn.read()) != -1 && hc != '\n' && hb.length() < 1024) {
                    hb.append((char) hc);
                }
                headerBytes += hb.length();
                headerLine = hb.toString().trim();
                if (headerLine.isEmpty()) break;
                if (headerLine.toLowerCase(Locale.ROOT).startsWith("range:")) {
                    rangeHeader = headerLine.substring(6).trim();
                }
            }

            // 代理拉流
            proxyStream(clientOut, requestedTarget, rangeHeader);
        } catch (java.net.SocketTimeoutException e) {
            try { writeError(clientOut, 504, "Gateway Timeout"); } catch (Exception ignored) {}
        } catch (Exception e) {
            try { writeError(clientOut, 502, "Bad Gateway"); } catch (Exception ignored) {}
        } finally {
            try { if (clientIn != null) clientIn.close(); } catch (Exception ignored) {}
            try { if (clientOut != null) clientOut.close(); } catch (Exception ignored) {}
            closeClient(client);
        }
    }

    /** 从目标 URL 拉流并透传到客户端。 */
    private void proxyStream(OutputStream clientOut, String targetUrl, String rangeHeader) throws IOException {
        HttpURLConnection conn = null;
        InputStream sourceIn = null;
        boolean responseStarted = false;
        try {
            URL url = new URL(targetUrl);
            int statusCode;
            for (int redirects = 0; ; redirects++) {
                conn = openUpstream(url);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(30000);
                conn.setRequestMethod("GET");
                conn.setUseCaches(false);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("Accept-Encoding", "identity");
                applyHeaders(conn, url.getHost().toLowerCase(Locale.ROOT));
                if (rangeHeader != null && !rangeHeader.isEmpty()) conn.setRequestProperty("Range", rangeHeader);
                statusCode = conn.getResponseCode();
                if (!(statusCode == 301 || statusCode == 302 || statusCode == 303 || statusCode == 307 || statusCode == 308)) break;
                String location = conn.getHeaderField("Location");
                if (redirects >= 5 || location == null || location.isEmpty()) throw new IOException("invalid_media_redirect");
                url = new URL(url, location);
                conn.disconnect();
                synchronized (this) { upstreams.remove(conn); }
                conn = null;
            }

            if (statusCode < 200 || statusCode >= 300) {
                writeError(clientOut, 502, "Upstream returned " + statusCode);
                return;
            }

            String contentType = conn.getContentType();
            long contentLength = conn.getContentLengthLong();
            String encoding = conn.getContentEncoding();
            if (encoding != null && !"identity".equalsIgnoreCase(encoding)) throw new IOException("unsupported_media_encoding");
            sourceIn = conn.getInputStream();
            if (isPlaylist(url, contentType)) {
                if (statusCode != 200 || contentLength > MAX_PLAYLIST_BYTES) throw new IOException("invalid_hls_response");
                ByteArrayOutputStream input = new ByteArrayOutputStream();
                byte[] chunk = new byte[BUFFER_SIZE];
                int count;
                while (running && (count = sourceIn.read(chunk)) != -1) {
                    if (input.size() + count > MAX_PLAYLIST_BYTES) throw new IOException("hls_playlist_too_large");
                    input.write(chunk, 0, count);
                }
                if (!running) throw new IOException("proxy_stopped");
                if (contentLength >= 0 && input.size() != contentLength) throw new IOException("incomplete_hls_playlist");
                String playlist = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(input.toByteArray())).toString();
                String rewritten = HlsPlaylistRewriter.rewrite(playlist, url, this::registerMediaUrl);
                byte[] body = rewritten.getBytes(StandardCharsets.UTF_8);
                responseStarted = true;
                clientOut.write(("HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nCache-Control: no-store\r\nContent-Length: "
                    + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                clientOut.write(body);
                clientOut.flush();
                return;
            }

            // 写响应头（保留 206 Partial Content 状态码，传递 Content-Range）
            int responseStatus = statusCode;
            String responseStatusLine = responseStatus == 206 ? "206 Partial Content" : "200 OK";
            StringBuilder response = new StringBuilder();
            response.append("HTTP/1.1 ").append(responseStatusLine).append("\r\n");
            response.append("Connection: close\r\n");
            response.append("Accept-Ranges: bytes\r\n");
            if (contentType != null) {
                response.append("Content-Type: ").append(contentType).append("\r\n");
            }
            if (contentLength >= 0) {
                response.append("Content-Length: ").append(contentLength).append("\r\n");
            }
            // 透传 Content-Range（206 响应必需）
            String contentRange = conn.getHeaderField("Content-Range");
            if (contentRange != null) {
                response.append("Content-Range: ").append(contentRange).append("\r\n");
            }
            // DLNA 流式标记
            response.append("transferMode.dlna.org: Streaming\r\n");
            response.append("\r\n");
            responseStarted = true;
            clientOut.write(response.toString().getBytes(StandardCharsets.UTF_8));
            clientOut.flush();

            // 透传流数据
            byte[] buffer = new byte[BUFFER_SIZE];
            int bytesRead;
            while (running && (bytesRead = sourceIn.read(buffer)) != -1) {
                clientOut.write(buffer, 0, bytesRead);
                clientOut.flush();
            }
        } catch (IOException error) {
            // Once binary data starts, close the connection; do not append an HTTP error to it.
            if (!responseStarted) writeError(clientOut, error instanceof java.net.SocketTimeoutException ? 504 : 502, "Media request failed");
        } finally {
            if (sourceIn != null) try { sourceIn.close(); } catch (Exception ignored) {}
            if (conn != null) {
                synchronized (this) { upstreams.remove(conn); }
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    private synchronized HttpURLConnection openUpstream(URL url) throws IOException {
        if (!running) throw new IOException("proxy_stopped");
        if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol()))) throw new IOException("unsupported_media_url");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        upstreams.add(connection);
        return connection;
    }

    private static boolean isPlaylist(URL url, String contentType) {
        String path = url.getPath().toLowerCase(Locale.ROOT);
        String type = contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return path.endsWith(".m3u8") || path.endsWith(".m3u") || type.equals("application/vnd.apple.mpegurl")
            || type.equals("audio/mpegurl") || type.equals("application/x-mpegurl") || type.equals("audio/x-mpegurl");
    }

    /** 根据目标域名应用合适的请求头。 */
    private void applyHeaders(HttpURLConnection conn, String domain) {
        // 通用浏览器 UA
        String ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
        String referer = "";

        if (domain.contains("bilibili") || domain.contains("b23")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 BiliApp/7.28.0 tvproj";
            referer = "https://www.bilibili.com/";
        } else if (domain.contains("iqiyi") || domain.contains("qiyi")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QYPlayer/14.0";
            referer = "https://www.iqiyi.com/";
        } else if (domain.contains("qq") || domain.contains("tencent")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QQLive/9.0";
            referer = "https://v.qq.com/";
        } else if (domain.contains("youku")) {
            referer = "https://www.youku.com/";
        } else if (domain.contains("mgtv")) {
            referer = "https://www.mgtv.com/";
        } else if (domain.contains("sohu")) {
            referer = "https://tv.sohu.com/";
        }

        conn.setRequestProperty("User-Agent", ua);
        if (!referer.isEmpty()) {
            conn.setRequestProperty("Referer", referer);
            conn.setRequestProperty("Origin", referer.substring(0, referer.length() - 1));
        }
    }

    private void writeError(OutputStream out, int code, String message) {
        try {
            String body = "{\"error\":" + code + ",\"message\":\"" + message + "\"}";
            byte[] bodyBytes = body.getBytes("UTF-8");
            String response = "HTTP/1.1 " + code + " " + message + "\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: " + bodyBytes.length + "\r\n" +
                "Connection: close\r\n\r\n";
            out.write(response.getBytes("UTF-8"));
            out.write(bodyBytes);
            out.flush();
        } catch (Exception ignored) {}
    }
}
