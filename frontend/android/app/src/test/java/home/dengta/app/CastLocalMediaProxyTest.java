package home.dengta.app;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketException;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import static org.junit.Assert.*;

public class CastLocalMediaProxyTest {
    private ServerSocket upstream;
    private Thread upstreamThread;
    private LocalMediaProxy proxy;
    private final AtomicInteger calls = new AtomicInteger();
    private String target;

    @Before public void start() throws Exception {
        upstream = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        upstreamThread = new Thread(() -> {
            while (!upstream.isClosed()) {
                try (Socket client = upstream.accept()) {
                    client.setSoTimeout(2000);
                    BufferedReader input = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                    String range = null, line;
                    while ((line = input.readLine()) != null && !line.isEmpty()) {
                        if (line.toLowerCase(java.util.Locale.ROOT).startsWith("range:")) range = line.substring(6).trim();
                    }
                    calls.incrementAndGet();
                    String body = "0123456789";
                    String headers = "HTTP/1.1 200 OK\r\n";
                    if (range != null) {
                        int offset = Integer.parseInt(range.substring(6, range.length() - 1));
                        body = body.substring(offset);
                        headers = "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes " + offset + "-9/10\r\n";
                    }
                    headers += "Content-Length: " + body.length() + "\r\nConnection: close\r\n\r\n";
                    client.getOutputStream().write((headers + body).getBytes(StandardCharsets.US_ASCII));
                    client.getOutputStream().flush();
                } catch (IOException ignored) { }
            }
        });
        upstreamThread.setDaemon(true);
        upstreamThread.start();
        target = "http://127.0.0.1:" + upstream.getLocalPort() + "/media";
        proxy = LocalMediaProxy.startRandom(target);
        assertNotNull(proxy);
    }

    @After public void stop() throws Exception {
        if (proxy != null) proxy.stop();
        if (upstream != null) upstream.close();
        if (upstreamThread != null) upstreamThread.join(2500);
    }

    @Test public void successiveRangeRequestsKeepWorkingAfterFirstConnectionCloses() throws Exception {
        assertEquals("0123456789", request(proxy.getProxyUrl(), null, 200));
        assertEquals("456789", request(proxy.getProxyUrl(), "bytes=4-", 206));
        assertEquals("89", request(proxy.getProxyUrl(), "bytes=8-", 206));
        assertEquals(3, calls.get());
    }

    @Test public void slowClientDoesNotBlockASeekOnAnotherConnection() throws Exception {
        try (Socket slow = new Socket("127.0.0.1", proxy.getPort())) {
            slow.getOutputStream().write("GET ".getBytes(StandardCharsets.US_ASCII));
            slow.getOutputStream().flush();
            assertEquals("6789", request(proxy.getProxyUrl(), "bytes=6-", 206));
        }
    }

    @Test public void targetCannotBeReplacedThroughTheLocalRequest() throws Exception {
        request(proxy.getProxyUrl() + "?url=" + target, null, 404);
        request("http://127.0.0.1:" + proxy.getPort() + "/proxy?url=" + target, null, 404);
        assertEquals(0, calls.get());
        assertFalse(proxy.getProxyUrl().contains(target));
        assertEquals("0123456789", request(proxy.getProxyUrl(), null, 200));
    }

    @Test public void stopClosesTheListeningSocketAndPartialRequests() throws Exception {
        int port = proxy.getPort();
        try (Socket client = new Socket("127.0.0.1", port)) {
            client.setSoTimeout(2000);
            client.getOutputStream().write("GET ".getBytes(StandardCharsets.US_ASCII));
            proxy.stop();
            proxy.stop();
            try { assertEquals(-1, client.getInputStream().read()); }
            catch (SocketException closed) { /* Reset is also a closed connection. */ }
        }
        try (Socket probe = new Socket()) {
            try {
                probe.connect(new InetSocketAddress("127.0.0.1", port), 1000);
                fail("stopped proxy still accepts connections");
            } catch (IOException expected) { }
        }
    }

    @Test public void listenerIsBoundToLoopbackAndRejectsNonHttpTargets() throws Exception {
        java.lang.reflect.Field field = LocalMediaProxy.class.getDeclaredField("serverSocket");
        field.setAccessible(true);
        java.net.ServerSocket server = (java.net.ServerSocket) field.get(proxy);
        assertEquals(InetAddress.getByName("127.0.0.1"), server.getInetAddress());
        assertNull(LocalMediaProxy.startRandom("file:///private/media"));
        assertNull(LocalMediaProxy.startRandom("not a URL"));
    }

    @Test public void stopDoesNotWaitForAStalledUpstreamBody() throws Exception {
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        try (ServerSocket stalled = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))) {
            Thread server = new Thread(() -> {
                try (Socket client = stalled.accept()) {
                    client.setSoTimeout(2000);
                    BufferedReader input = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                    String line;
                    while ((line = input.readLine()) != null && !line.isEmpty()) { }
                    client.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n0".getBytes(StandardCharsets.US_ASCII));
                    client.getOutputStream().flush();
                    release.await(5, java.util.concurrent.TimeUnit.SECONDS);
                } catch (Exception ignored) { }
            });
            server.setDaemon(true);
            server.start();
            proxy.stop();
            proxy = LocalMediaProxy.startRandom("http://127.0.0.1:" + stalled.getLocalPort() + "/media");
            assertNotNull(proxy);
            HttpURLConnection connection = (HttpURLConnection) new URL(proxy.getProxyUrl()).openConnection();
            connection.setReadTimeout(2000);
            try (InputStream input = connection.getInputStream()) {
                assertEquals('0', input.read());
                java.util.concurrent.FutureTask<Void> stopping = new java.util.concurrent.FutureTask<>(() -> { proxy.stop(); return null; });
                Thread caller = new Thread(stopping);
                caller.setDaemon(true);
                caller.start();
                stopping.get(2, java.util.concurrent.TimeUnit.SECONDS);
                try { assertEquals(-1, input.read()); } catch (IOException closed) { }
            } finally {
                release.countDown();
                connection.disconnect();
                server.join(2500);
            }
        } finally { release.countDown(); }
    }

    private String request(String uri, String range, int expectedStatus) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(uri).openConnection();
        connection.setConnectTimeout(2000);
        connection.setReadTimeout(2000);
        if (range != null) connection.setRequestProperty("Range", range);
        try {
            assertEquals(expectedStatus, connection.getResponseCode());
            if (expectedStatus == 206) assertNotNull(connection.getHeaderField("Content-Range"));
            try (InputStream input = expectedStatus >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                return new String(input.readAllBytes(), StandardCharsets.UTF_8);
            }
        } finally { connection.disconnect(); }
    }
}
