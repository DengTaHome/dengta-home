package home.dengta.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.Locale;
import java.util.UUID;

/**
 * DLNA / UPnP 媒体接收端（MediaRenderer）。
 *
 * 完成的事：
 *  1. SSDP 发现：在 239.255.255.250:1900 响应 M-SEARCH，让视频 App（B站/腾讯/爱奇艺等）
 *     在「投屏」设备列表里看到「灯塔 DENGTA」。
 *  2. HTTP 服务器：提供 UPnP 设备描述 XML（description.xml）+ AVTransport/ConnectionManager/
 *     RenderingControl 三个 SOAP 服务端点。
 *  3. 收到 SetAVTransportURI 时取出媒体 URL，通过广播把 URI 交给 DlnaReceiverPlugin，
 *     由插件 notifyListeners("mediaReceived") 通知前端内置播放器启动，并进入「一起看」。
 *
 * 广播动作：home.dengta.app.bl.DLNA_MEDIA_RECEIVED（extra: uri/meta）
 * 状态 action：home.dengta.app.bl.DLNA_STATE_CHANGED（extra: state: running|stopped）
 */
public final class DlnaReceiverService extends Service {
    static final String ACTION_START = "home.dengta.app.bl.START";
    static final String ACTION_STOP = "home.dengta.app.bl.STOP";
    static final String ACTION_STATE = "home.dengta.app.bl.STATE";

    static final String EXTRA_STATE = "state";
    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_META_JSON = "meta_json";

    static final String MEDIA_RECEIVED_ACTION = "home.dengta.app.bl.DLNA_MEDIA_RECEIVED";

    private static final String CHANNEL_ID = "dengta-dlna-v1";
    private static final int NOTIFICATION_ID = 9429;
    private static final String PREFS_NAME = "dengta_dlna";
    private static final String DEVICE_ID_KEY = "device_id";
    private static final String ENABLED_KEY = "enabled";
    private static final String PENDING_URI_KEY = "pending_uri";
    private static final String PENDING_TITLE_KEY = "pending_title";
    private static final String PENDING_META_KEY = "pending_meta";

    private static final String SSDP_ADDR = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final int HTTP_PORT = 48620;
    private static final String DEVICE_TYPE = "urn:schemas-upnp-org:device:MediaRenderer:1";

    private static volatile boolean running = false;
    private static volatile boolean wifiAware = false;
    private static final DlnaDiscovery discovery = new DlnaDiscovery();

    // —— 播放状态机（供 SOAP 查询，也供前端感知） ——
    static volatile String transportState = "STOPPED";
    static volatile String currentUri = "";
    private static volatile String currentMeta = "";
    private static volatile String trackDuration = "00:00:00";

    private static volatile DlnaReceiverService activeInstance;

    private HandlerThread ssdpThread;
    private HandlerThread httpThread;
    private Handler mainHandler;
    private Handler ssdpHandler;
    private Handler httpHandler;
    private volatile DatagramSocket ssdpSocket;
    private volatile ServerSocket httpServer;
    private volatile String advertisedAddress = "";
    private WifiManager.MulticastLock multicastLock;
    private String deviceId = "";

    public static boolean isRunning() {
        return running;
    }

    public static boolean isReady() {
        return discovery.snapshot().active;
    }

    public static String stateJson() {
        JSONObject state = new JSONObject();
        DlnaDiscovery.Snapshot status = discovery.snapshot();
        try {
            state.put("supported", true);
            state.put("active", status.active);
            state.put("ssdpReady", status.ssdpReady);
            state.put("httpReady", status.httpReady);
            state.put("discoveryStatus", status.status);
            state.put("errorCode", status.errorCode);
            state.put("enabled", running);
            state.put("port", HTTP_PORT);
            state.put("transportState", transportState);
            state.put("currentUri", currentUri);
            state.put("mediaReceived", currentUri.isEmpty() ? "" : currentUri);
        } catch (Exception ignored) {
        }
        return state.toString();
    }

    static JSObject buildState(Context context) {
        JSObject state = new JSObject();
        DlnaDiscovery.Snapshot status = discovery.snapshot();
        try {
            state.put("supported", true);
            state.put("active", status.active);
            state.put("ssdpReady", status.ssdpReady);
            state.put("httpReady", status.httpReady);
            state.put("discoveryStatus", status.status);
            state.put("errorCode", status.errorCode);
            boolean enabled = prefs(context).getBoolean(ENABLED_KEY, false);
            state.put("enabled", enabled);
            state.put("port", HTTP_PORT);
            state.put("transportState", transportState);
            state.put("currentUri", currentUri);
            state.put("wifiAware", wifiAware);
            String wifiName = "";
            try {
                WifiManager wm = (WifiManager) context.getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
                WifiInfo info = wm != null ? wm.getConnectionInfo() : null;
                if (info != null && info.getSSID() != null) {
                    wifiName = info.getSSID().replace("\"", "");
                }
            } catch (Exception ignored) {
            }
            state.put("wifiName", wifiName);
            // 待处理媒体（App 在前台错过事件时，前端可轮询恢复）
            state.put("pendingUri", prefs(context).getString(PENDING_URI_KEY, ""));
            state.put("pendingTitle", prefs(context).getString(PENDING_TITLE_KEY, ""));
            state.put("pendingMetaJson", prefs(context).getString(PENDING_META_KEY, ""));
        } catch (Exception ignored) {
        }
        return state;
    }

    /** 用户上次是否开启过投屏接收（用于 App 启动后自动恢复服务）。 */
    public static boolean isEnabled(Context context) {
        try {
            return prefs(context).getBoolean(ENABLED_KEY, false);
        } catch (Exception ignored) {
            return false;
        }
    }

    /** 确保每次 App 启动后投屏接收默认开启。 */
    public static void ensureEnabledByDefault(Context context) {
        try {
            prefs(context).edit().putBoolean(ENABLED_KEY, true).apply();
        } catch (Exception ignored) {
        }
    }

    /** 前端确认已处理投屏媒体后调用，清空待处理缓存。 */
    public static void clearPending(Context context) {
        try {
            prefs(context).edit()
                .remove(PENDING_URI_KEY)
                .remove(PENDING_TITLE_KEY)
                .remove(PENDING_META_KEY)
                .apply();
        } catch (Exception ignored) {
        }
    }

    public static Intent startIntent(Context context) {
        return new Intent(context, DlnaReceiverService.class).setAction(ACTION_START);
    }

    public static Intent stopIntent(Context context) {
        return new Intent(context, DlnaReceiverService.class).setAction(ACTION_STOP);
    }

    public static void sendAction(Context context, String action) {
        try {
            Intent intent = new Intent(context, DlnaReceiverService.class).setAction(action);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(getMainLooper());
        createNotificationChannel();
        activeInstance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopReceiver();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) {
            if (ACTION_START.equals(action) && !discovery.snapshot().errorCode.isEmpty()) {
                stopReceiver();
            } else {
                installForegroundNotification();
                return START_STICKY;
            }
        }
        prefs(this).edit().putBoolean(ENABLED_KEY, true).apply();
        startReceiver();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopReceiver();
        // 移除前台通知，避免服务停止后通知残留
        try {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        activeInstance = null;
        super.onDestroy();
    }

    // ---------------------------------------------------------------- 启动/停止

    private void startReceiver() {
        running = true;
        long generation = discovery.begin(this::sendSsdpAlive);
        deviceId = readOrCreateDeviceId();
        installForegroundNotification();
        try {
            WifiManager wm = (WifiManager) getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                multicastLock = wm.createMulticastLock("dengta-dlna-multicast");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
                wifiAware = multicastLock.isHeld();
            }
        } catch (Exception ignored) {
        }
        ssdpThread = new HandlerThread("dengta-dlna-ssdp");
        ssdpThread.start();
        ssdpHandler = new Handler(ssdpThread.getLooper());
        httpThread = new HandlerThread("dengta-dlna-http");
        httpThread.start();
        httpHandler = new Handler(httpThread.getLooper());

        startSsdpLoop(generation, 0);
        startHttpServer(generation);
        broadcastState();
    }

    private void stopReceiver() {
        running = false;
        discovery.stop();
        // 停止前发送 ssdp:byebye 通知，告知局域网设备已下线
        if (ssdpSocket != null) {
            try { sendSsdpByebye(); } catch (Exception ignored) {}
        }
        prefs(this).edit().putBoolean(ENABLED_KEY, false).apply();
        if (multicastLock != null) {
            try {
                multicastLock.release();
            } catch (Exception ignored) {
            }
            multicastLock = null;
        }
        wifiAware = false;
        closeQuietly(ssdpSocket);
        closeQuietly(httpServer);
        ssdpSocket = null;
        httpServer = null;
        advertisedAddress = "";
        if (ssdpHandler != null) ssdpHandler.removeCallbacksAndMessages(null);
        if (httpHandler != null) httpHandler.removeCallbacksAndMessages(null);
        if (ssdpThread != null) {
            ssdpThread.quitSafely();
            ssdpThread = null;
        }
        if (httpThread != null) {
            httpThread.quitSafely();
            httpThread = null;
        }
        transportState = "STOPPED";
        currentUri = "";
        currentMeta = "";
        broadcastState();
    }

    // ---------------------------------------------------------------- SSDP

    private void startSsdpLoop(long generation, int attempt) {
        ssdpHandler.post(() -> {
            if (!running || !discovery.isCurrent(generation)) return;
            MulticastSocket socket = null;
            String errorCode = "dlna_network_unavailable";
            try {
                String address = findLocalIpAddress();
                NetworkInterface network = address.isEmpty() ? null
                    : NetworkInterface.getByInetAddress(InetAddress.getByName(address));
                if (network == null || !network.isUp() || !network.supportsMulticast()) {
                    throw new IOException("No multicast LAN interface");
                }
                errorCode = "dlna_ssdp_bind_failed";
                socket = new MulticastSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), SSDP_PORT));
                socket.setSoTimeout(2000);
                errorCode = "dlna_multicast_join_failed";
                socket.setNetworkInterface(network);
                socket.joinGroup(new InetSocketAddress(SSDP_ADDR, SSDP_PORT), network);
                synchronized (discovery) {
                    if (!running || !discovery.isCurrent(generation)) return;
                    ssdpSocket = socket;
                    advertisedAddress = address;
                    discovery.ready(generation, false);
                }
                broadcastState();
                publishDebug("ssdp bound to port " + SSDP_PORT + " on attempt " + (attempt + 1));
                errorCode = "dlna_ssdp_receive_failed";
                while (running && discovery.isCurrent(generation) && ssdpSocket == socket) {
                    try {
                        byte[] buffer = new byte[8192];
                        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                        socket.receive(packet);
                        if (discovery.snapshot().active) handleSsdpPacket(socket, packet);
                    } catch (SocketTimeoutException ignored) {
                    }
                }
            } catch (Exception socketError) {
                if (discovery.failed(generation, false, errorCode)) {
                    publishDebug(errorCode + " (attempt " + (attempt + 1) + "): " + safeMsg(socketError));
                    broadcastState();
                    if (attempt < 9) ssdpHandler.postDelayed(
                        () -> startSsdpLoop(generation, attempt + 1), 3000L * (attempt + 1));
                }
            } finally {
                closeQuietly(socket);
                if (ssdpSocket == socket) ssdpSocket = null;
            }
        });
    }

    private void handleSsdpPacket(DatagramSocket socket, DatagramPacket packet) throws IOException {
        String request = new String(packet.getData(), packet.getOffset(), packet.getLength(),
            StandardCharsets.UTF_8);
        if (!request.contains("M-SEARCH")) return;
        boolean matchAll = request.contains("ssdp:all");
        boolean matchRenderer = request.contains("urn:schemas-upnp-org:device:MediaRenderer:1");
        boolean matchRoot = request.contains("upnp:rootdevice");
        boolean matchUuid = request.contains(deviceId);
        if (!matchAll && !matchRenderer && !matchRoot && !matchUuid) return;
        String localIp = localIpAddress();
        if (localIp.isEmpty()) return;
        String location = "http://" + localIp + ":" + HTTP_PORT + "/description.xml";
        String uuidPrefix = "uuid:" + deviceId;
        // 构造三条响应（rootdevice / deviceType / uuid），满足 UPnP 规范对 ssdp:all 的要求
        String[] ntList = {
            "upnp:rootdevice",
            DEVICE_TYPE,
            uuidPrefix
        };
        String[] usnList = {
            uuidPrefix + "::upnp:rootdevice",
            uuidPrefix + "::" + DEVICE_TYPE,
            uuidPrefix
        };
        // RFC 1123 DATE 头：部分严格客户端（爱奇艺/腾讯视频）要求 M-SEARCH 响应带 DATE
        String dateHeader = java.text.SimpleDateFormat.getDateTimeInstance(
                java.text.SimpleDateFormat.MEDIUM, java.text.SimpleDateFormat.MEDIUM, Locale.US)
            .format(new java.util.Date());
        for (int i = 0; i < ntList.length; i++) {
            String st = ntList[i];
            if (!matchAll && !matchRoot && !st.equals(DEVICE_TYPE) && !st.equals(uuidPrefix)) continue;
            if (!matchAll && !matchRenderer && st.equals(DEVICE_TYPE) && !matchUuid) continue;
            if (!matchAll && !matchRoot && st.equals("upnp:rootdevice")) continue;
            String response =
                "HTTP/1.1 200 OK\r\n"
                    + "CACHE-CONTROL: max-age=1800\r\n"
                    + "DATE: " + dateHeader + "\r\n"
                    + "EXT:\r\n"
                    + "LOCATION: " + location + "\r\n"
                    + "SERVER: DENGTA/2.10 UPnP/1.0 DENGTA-DLNA/1.0\r\n"
                    + "ST: " + st + "\r\n"
                    + "USN: " + usnList[i] + "\r\n"
                    + "BOOTID.UPNP.ORG: 1\r\n"
                    + "CONFIGID.UPNP.ORG: 1\r\n"
                    + "SUPPORTS.LV.UPNP.ORG: 1\r\n"
                    + "\r\n";
            byte[] payload = response.getBytes(StandardCharsets.UTF_8);
            DatagramPacket out = new DatagramPacket(
                payload, payload.length, packet.getAddress(), packet.getPort());
            socket.send(out);
        }
    }

    private void sendSsdpAlive() {
        if (ssdpSocket == null || ssdpSocket.isClosed()) return;
        String localIp = localIpAddress();
        if (localIp.isEmpty()) return;
        String location = "http://" + localIp + ":" + HTTP_PORT + "/description.xml";
        String uuidPrefix = "uuid:" + deviceId;

        // 发送三条 NOTIFY（rootdevice / deviceType / UUID），满足 UPnP 规范对 ssdp:all 的发现要求
        String[] ntList = {
            "upnp:rootdevice",
            DEVICE_TYPE,
            uuidPrefix
        };
        String[] usnList = {
            uuidPrefix + "::upnp:rootdevice",
            uuidPrefix + "::" + DEVICE_TYPE,
            uuidPrefix
        };
        for (int i = 0; i < ntList.length; i++) {
            String alive =
                "NOTIFY * HTTP/1.1\r\n"
                    + "HOST: 239.255.255.250:1900\r\n"
                    + "CACHE-CONTROL: max-age=1800\r\n"
                    + "LOCATION: " + location + "\r\n"
                    + "NT: " + ntList[i] + "\r\n"
                    + "NTS: ssdp:alive\r\n"
                    + "SERVER: DENGTA/2.10 UPnP/1.0 DENGTA-DLNA/1.0\r\n"
                    + "USN: " + usnList[i] + "\r\n"
                    + "BOOTID.UPNP.ORG: 1\r\n"
                    + "CONFIGID.UPNP.ORG: 1\r\n"
                    + "SUPPORTS.LV.UPNP.ORG: 1\r\n"
                    + "\r\n";
            try {
                InetAddress group = InetAddress.getByName(SSDP_ADDR);
                byte[] payload = alive.getBytes(StandardCharsets.UTF_8);
                DatagramPacket packet = new DatagramPacket(payload, payload.length, group, SSDP_PORT);
                ssdpSocket.send(packet);
            } catch (Exception ignored) {
            }
        }
    }

    private void sendSsdpByebye() {
        if (ssdpSocket == null || ssdpSocket.isClosed()) return;
        String localIp = localIpAddress();
        if (localIp.isEmpty()) return;
        String location = "http://" + localIp + ":" + HTTP_PORT + "/description.xml";
        String usn = "uuid:" + deviceId + "::" + DEVICE_TYPE;
        String nt = DEVICE_TYPE;
        String byebye =
            "NOTIFY * HTTP/1.1\r\n"
                + "HOST: 239.255.255.250:1900\r\n"
                + "CACHE-CONTROL: max-age=1800\r\n"
                + "LOCATION: " + location + "\r\n"
                + "NT: " + nt + "\r\n"
                + "NTS: ssdp:byebye\r\n"
                + "SERVER: DENGTA/2.10 UPnP/1.0 DENGTA-DLNA/1.0\r\n"
                + "USN: " + usn + "\r\n"
                + "\r\n";
        try {
            InetAddress group = InetAddress.getByName(SSDP_ADDR);
            byte[] payload = byebye.getBytes(StandardCharsets.UTF_8);
            DatagramPacket packet = new DatagramPacket(payload, payload.length, group, SSDP_PORT);
            ssdpSocket.send(packet);
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------- HTTP / SOAP

    private void startHttpServer(long generation) {
        httpHandler.post(() -> {
            if (!running || !discovery.isCurrent(generation)) return;
            ServerSocket server = null;
            String errorCode = "dlna_http_bind_failed";
            try {
                server = new ServerSocket();
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress(HTTP_PORT));
                synchronized (discovery) {
                    if (!running || !discovery.isCurrent(generation)) return;
                    httpServer = server;
                    discovery.ready(generation, true);
                }
                broadcastState();
                errorCode = "dlna_http_receive_failed";
                while (running && discovery.isCurrent(generation) && httpServer == server) {
                    Socket client = server.accept();
                    handleHttpClient(client);
                }
            } catch (Exception httpError) {
                if (discovery.failed(generation, true, errorCode)) {
                    publishDebug(errorCode + ": " + safeMsg(httpError));
                    broadcastState();
                }
            } finally {
                closeQuietly(server);
                if (httpServer == server) httpServer = null;
            }
        });
    }

    private void handleHttpClient(final Socket client) {
        threadPoolExecutorSafe(() -> {
            try (Socket socket = client;
                 InputStream input = socket.getInputStream();
                 OutputStream output = socket.getOutputStream()) {
                socket.setSoTimeout(10000);
                String requestLine = readLine(input);
                if (requestLine == null || requestLine.isEmpty()) return;
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) return;
                String method = parts[0];
                String path = parts[1];
                // 读取请求头并提取 Content-Length（避免 keep-alive 下等 EOF 卡 5 秒）
                int contentLength = -1;
                while (true) {
                    String line = readLine(input);
                    if (line == null || line.isEmpty()) break;
                    int colon = line.indexOf(':');
                    if (colon > 0) {
                        String name = line.substring(0, colon).trim();
                        String value = line.substring(colon + 1).trim();
                        if ("content-length".equalsIgnoreCase(name)) {
                            try {
                                contentLength = Integer.parseInt(value);
                            } catch (NumberFormatException ignored) {
                            }
                        }
                    }
                }
                if ("GET".equalsIgnoreCase(method) && path.contains("description.xml")) {
                    byte[] body = deviceDescription().getBytes(StandardCharsets.UTF_8);
                    writeHttpResponse(output, "200 OK", "text/xml; charset=\"utf-8\"",
                        body);
                } else if ("GET".equalsIgnoreCase(method) && path.contains("icon.png")) {
                    // 1x1 透明 PNG（48x48 缩放后也 OK，避免客户端 icon 404 影响发现）
                    byte[] png = android.util.Base64.decode(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
                            + "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                        android.util.Base64.DEFAULT);
                    writeHttpResponse(output, "200 OK", "image/png", png);
                } else if ("GET".equalsIgnoreCase(method)
                           && (path.contains("/avt") || path.contains("/cm") || path.contains("/rc"))
                           && (!path.contains("/event"))) {
                    // SCPD 动作描述：很多控制点（含 B站）在投屏前先拉 SCPD 确认动作
                    byte[] scpd = scpdFor(path).getBytes(StandardCharsets.UTF_8);
                    writeHttpResponse(output, "200 OK", "text/xml; charset=\"utf-8\"",
                        scpd);
                } else if ("SUBSCRIBE".equalsIgnoreCase(method)
                           || "UNSUBSCRIBE".equalsIgnoreCase(method)) {
                    // 事件订阅：返回 200 + 订阅超时即可（控制点通常忽略内容）
                    StringBuilder head = new StringBuilder();
                    head.append("HTTP/1.1 200 OK\r\n");
                    head.append("Content-Length: 0\r\n");
                    head.append("SID: uuid:").append(uuidDevice()).append("\r\n");
                    head.append("TIMEOUT: Second-300\r\n");
                    head.append("Connection: close\r\n\r\n");
                    output.write(head.toString().getBytes(StandardCharsets.UTF_8));
                    output.flush();
                } else if (("OPTIONS".equalsIgnoreCase(method))) {
                    StringBuilder head = new StringBuilder();
                    head.append("HTTP/1.1 200 OK\r\n");
                    head.append("Content-Length: 0\r\n");
                    head.append("Connection: close\r\n\r\n");
                    output.write(head.toString().getBytes(StandardCharsets.UTF_8));
                    output.flush();
                } else if ("POST".equalsIgnoreCase(method)) {
                    byte[] body = readBody(input, contentLength);
                    handleSoapRequest(path, body, output);
                } else {
                    writeHttpResponse(output, "404 Not Found", "text/plain",
                        "not found".getBytes(StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) {
                Log.w("DlnaReceiverService", "handleHttpClient error: " + safeMsg(ignored));
            }
        });
    }

    private void handleSoapRequest(String path, byte[] body, OutputStream output)
        throws IOException {
        try {
            String xml = new String(body, StandardCharsets.UTF_8);
            String action = !findTag(xml, "SetAVTransportURI").isEmpty() ? "SetAVTransportURI"
                : !findTag(xml, "Play").isEmpty() ? "Play"
                : !findTag(xml, "Pause").isEmpty() ? "Pause"
                : !findTag(xml, "Stop").isEmpty() ? "Stop"
                : !findTag(xml, "Seek").isEmpty() ? "Seek"
                : !findTag(xml, "GetTransportInfo").isEmpty() ? "GetTransportInfo"
                : !findTag(xml, "GetPositionInfo").isEmpty() ? "GetPositionInfo"
                : !findTag(xml, "GetProtocolInfo").isEmpty() ? "GetProtocolInfo"
                : !findTag(xml, "GetVolume").isEmpty() ? "GetVolume"
                : !findTag(xml, "SetVolume").isEmpty() ? "SetVolume"
                : !findTag(xml, "GetCurrentConnectionInfo").isEmpty() ? "GetCurrentConnectionInfo"
                : !findTag(xml, "GetDeviceCapabilities").isEmpty() ? "GetDeviceCapabilities"
                : "";
            Log.i("DlnaReceiverService", "handleSoapRequest: path=" + path + " action=" + action);
            // 不打印完整 XML：含签名 URL/播放元数据，可能有隐私与泄露风险
            switch (action) {
                case "SetAVTransportURI": {
                    String uri = unescapeXml(findTag(xml, "CurrentURI"));
                    // meta 里嵌的是被 XML 双重转义的 DIDL-Lite（&lt;dc:title&gt;），先反转义再提取标题
                    String meta = unescapeXml(findTag(xml, "CurrentURIMetaData"));
                    transportState = "PLAYING";
                    currentUri = uri;
                    currentMeta = meta;
                    publishReceivedMedia(uri, meta);
                    writeSoapResponse(output, "u:SetAVTransportURIResponse",
                        "177", "<u:SetAVTransportURIResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"></u:SetAVTransportURIResponse>");
                    break;
                }
                case "Play":
                    transportState = "PLAYING";
                    writeSoapResponse(output, "u:PlayResponse",
                        "178", "<u:PlayResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"></u:PlayResponse>");
                    break;
                case "Pause":
                    transportState = "PAUSED_PLAYBACK";
                    writeSoapResponse(output, "u:PauseResponse",
                        "179", "<u:PauseResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"></u:PauseResponse>");
                    break;
                case "Stop":
                    transportState = "STOPPED";
                    writeSoapResponse(output, "u:StopResponse",
                        "180", "<u:StopResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"></u:StopResponse>");
                    break;
                case "Seek": {
                    String target = findTag(xml, "Target");
                    writeSoapResponse(output, "u:SeekResponse",
                        "181", "<u:SeekResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"></u:SeekResponse>");
                    break;
                }
                case "GetTransportInfo": {
                    String state = switch (transportState) {
                        case "PAUSED_PLAYBACK" -> "PAUSED_PLAYBACK";
                        case "STOPPED" -> "STOPPED";
                        default -> "PLAYING";
                    };
                    String bodyXml = "<u:GetTransportInfoResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
                        + "<CurrentTransportState>" + state + "</CurrentTransportState>"
                        + "<CurrentTransportStatus>OK</CurrentTransportStatus>"
                        + "<CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse>";
                    writeSoapResponse(output, "u:GetTransportInfoResponse",
                        "182", bodyXml);
                    break;
                }
                case "GetTransportSettings": {
                    String bodyXml = "<u:GetTransportSettingsResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
                        + "<PlayMode>NORMAL</PlayMode>"
                        + "<RecQualityMode>NONE</RecQualityMode>"
                        + "</u:GetTransportSettingsResponse>";
                    writeSoapResponse(output, "u:GetTransportSettingsResponse",
                        "189", bodyXml);
                    break;
                }
                case "GetMediaInfo": {
                    String bodyXml = "<u:GetMediaInfoResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
                        + "<NrTracks>1</NrTracks>"
                        + "<MediaDuration>" + trackDuration + "</MediaDuration>"
                        + "<CurrentURI>" + escapeXml(currentUri) + "</CurrentURI>"
                        + "<CurrentURIMetaData>" + escapeXml(currentMeta) + "</CurrentURIMetaData>"
                        + "<NextURI></NextURI><NextURIMetaData></NextURIMetaData>"
                        + "<PlayMedium>NONE</PlayMedium><RecordMedium>NONE</RecordMedium>"
                        + "<WriteStatus>NOT_IMPLEMENTED</WriteStatus>"
                        + "</u:GetMediaInfoResponse>";
                    writeSoapResponse(output, "u:GetMediaInfoResponse",
                        "190", bodyXml);
                    break;
                }
                case "GetPositionInfo": {
                    String bodyXml = "<u:GetPositionInfoResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
                        + "<Track>0</Track><TrackDuration>" + trackDuration + "</TrackDuration>"
                        + "<TrackMetaData>" + escapeXml(currentMeta) + "</TrackMetaData>"
                        + "<TrackURI>" + escapeXml(currentUri) + "</TrackURI>"
                        + "<RelTime>00:00:00</RelTime><AbsTime>00:00:00</AbsTime>"
                        + "<RelCount>0</RelCount><AbsCount>0</AbsCount></u:GetPositionInfoResponse>";
                    writeSoapResponse(output, "u:GetPositionInfoResponse",
                        "183", bodyXml);
                    break;
                }
                case "GetProtocolInfo": {
                    String bodyXml = "<u:GetProtocolInfoResponse xmlns:u=\"urn:schemas-upnp-org:service:ConnectionManager:1\">"
                        + "<Source></Source>"
                        + "<Sink>http-get:*:video/*:*," +
                        "http-get:*:audio/*:*," +
                        "http-get:*:application/x-mpegURL:*," +
                        "http-get:*:application/vnd.apple.mpegurl:*</Sink></u:GetProtocolInfoResponse>";
                    writeSoapResponse(output, "u:GetProtocolInfoResponse",
                        "184", bodyXml);
                    break;
                }
                case "GetVolume": {
                    String bodyXml = "<u:GetVolumeResponse xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\">"
                        + "<CurrentVolume>50</CurrentVolume></u:GetVolumeResponse>";
                    writeSoapResponse(output, "u:GetVolumeResponse",
                        "185", bodyXml);
                    break;
                }
                case "SetVolume":
                    writeSoapResponse(output, "u:SetVolumeResponse",
                        "186", "<u:SetVolumeResponse xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"></u:SetVolumeResponse>");
                    break;
                case "GetCurrentConnectionInfo": {
                    String bodyXml = "<u:GetCurrentConnectionInfoResponse xmlns:u=\"urn:schemas-upnp-org:service:ConnectionManager:1\">"
                        + "<RcsID>0</RcsID><AVTransportID>0</AVTransportID>"
                        + "<ProtocolInfo>http-get:*:video/*:*</ProtocolInfo>"
                        + "<PeerConnectionManager>/</PeerConnectionManager>"
                        + "<PeerConnectionID>-1</PeerConnectionID>"
                        + "<Direction>Input</Direction><Status>OK</Status></u:GetCurrentConnectionInfoResponse>";
                    writeSoapResponse(output, "u:GetCurrentConnectionInfoResponse",
                        "187", bodyXml);
                    break;
                }
                case "GetDeviceCapabilities": {
                    String bodyXml = "<u:GetDeviceCapabilitiesResponse xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"
                        + "<PlayMedia>NONE</PlayMedia><RecMedia>NONE</RecMedia>"
                        + "<RecQualityModes>NONE</RecQualityModes></u:GetDeviceCapabilitiesResponse>";
                    writeSoapResponse(output, "u:GetDeviceCapabilitiesResponse",
                        "188", bodyXml);
                    break;
                }
                default:
                    writeHttpResponse(output, "500 Internal Server Error", "text/xml",
                        ("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">"
                            + "<s:Body><s:Fault><faultcode>s:Client</faultcode>"
                            + "<faultstring>UPnPError</faultstring>"
                            + "<detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\">"
                            + "<errorCode>401</errorCode>"
                            + "<errorDescription>Invalid Action</errorDescription>"
                            + "</UPnPError></detail></s:Fault></s:Body></s:Envelope>")
                            .getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception soapError) {
            String errMsg = soapError.getMessage();
            if (errMsg == null) errMsg = "Unknown SOAP error";
            writeHttpResponse(output, "500 Internal Server Error", "text/plain",
                errMsg.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String scpdFor(String path) {
        String actions = "SetAVTransportURI,SetNextAVTransportURI,Play,Pause,Stop,Seek,"
            + "GetTransportInfo,GetPositionInfo,GetTransportSettings,GetMediaInfo,"
            + "GetProtocolInfo,GetCurrentConnectionInfo,GetDeviceCapabilities,"
            + "GetVolume,SetVolume";
        boolean isAVT = path.contains("/avt");
        boolean isCM = path.contains("/cm");
        boolean isRC = path.contains("/rc");
        if (isCM) {
            actions = "GetProtocolInfo,GetCurrentConnectionIDs,GetCurrentConnectionInfo";
        } else if (isRC) {
            actions = "GetVolume,SetVolume,GetMute,SetMute";
        }
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>")
            .append("<scpd xmlns=\"urn:schemas-upnp-org:service-1-0\">")
            .append("<specVersion><major>1</major><minor>0</minor></specVersion>")
            .append("<actionList>");
        for (String a : actions.split(",")) {
            sb.append("<action><name>").append(a).append("</name><argumentList>");
            // SetAVTransportURI 需要特定参数，否则某些客户端（爱奇艺等）会拒绝调用
            if ("SetAVTransportURI".equals(a)) {
                sb.append("<argument><name>InstanceID</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>")
                    .append("<argument><name>CurrentURI</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_URI</relatedStateVariable></argument>")
                    .append("<argument><name>CurrentURIMetaData</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_URIMetaData</relatedStateVariable></argument>");
            } else if ("SetNextAVTransportURI".equals(a)) {
                sb.append("<argument><name>InstanceID</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>")
                    .append("<argument><name>NextURI</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_URI</relatedStateVariable></argument>")
                    .append("<argument><name>NextURIMetaData</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_URIMetaData</relatedStateVariable></argument>");
            } else if ("Seek".equals(a)) {
                sb.append("<argument><name>InstanceID</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>")
                    .append("<argument><name>Unit</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_SeekMode</relatedStateVariable></argument>")
                    .append("<argument><name>Target</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_SeekTarget</relatedStateVariable></argument>");
            } else if ("SetVolume".equals(a)) {
                sb.append("<argument><name>InstanceID</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>")
                    .append("<argument><name>DesiredVolume</name><direction>in</direction>")
                    .append("<relatedStateVariable>Volume</relatedStateVariable></argument>");
            } else {
                // 其他动作：只带 InstanceID
                sb.append("<argument><name>InstanceID</name><direction>in</direction>")
                    .append("<relatedStateVariable>A_ARG_TYPE_InstanceID</relatedStateVariable></argument>");
            }
            sb.append("</argumentList></action>");
        }
        sb.append("</actionList><serviceStateTable>")
            .append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_InstanceID</name>")
            .append("<dataType>ui4</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_URI</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_URIMetaData</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_SeekMode</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_SeekTarget</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"yes\"><name>TransportState</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"yes\"><name>CurrentTrackURI</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>SourceProtocolInfo</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>SinkProtocolInfo</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"yes\"><name>Volume</name>")
            .append("<dataType>ui2</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"yes\"><name>Mute</name>")
            .append("<dataType>boolean</dataType></stateVariable>")
            .append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_AudioChannel</name>")
            .append("<dataType>string</dataType></stateVariable>")
            .append("</serviceStateTable></scpd>");
        return sb.toString();
    }

    private void writeSoapResponse(OutputStream output, String action,
                                   String serviceKey, String bodyXml) throws IOException {
        // 注意：bodyXml 内部各动作已带正确的 xmlns:u 声明，此处 envelope 命名空间仅作形式占位。
        // （早期版本曾尝试依据 action 推断 namespace，但 body 内声明已足够，控制点只认 u:Action 内容）
        String envelope = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
            + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
            + "<s:Body>" + bodyXml + "</s:Body></s:Envelope>";
        writeHttpResponse(output, "200 OK", "text/xml; charset=\"utf-8\"",
            envelope.getBytes(StandardCharsets.UTF_8));
    }

    private String deviceDescription() {
        String ip = localIpAddress();
        String host = ip.isEmpty() ? "127.0.0.1" : ip;
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<root xmlns=\"urn:schemas-upnp-org:device-1-0\""
            + " xmlns:dlna=\"urn:schemas-dlna-org:device-1-0\">"
            + "<specVersion><major>1</major><minor>0</minor></specVersion>"
            + "<device>"
            + "<deviceType>" + DEVICE_TYPE + "</deviceType>"
            + "<friendlyName>\u706F\u5854 DENGTA</friendlyName>"
            + "<manufacturer>DengTa Home</manufacturer>"
            + "<manufacturerURL>https://dengtahome.com</manufacturerURL>"
            + "<modelDescription>DENGTA DLNA Media Renderer</modelDescription>"
            + "<modelName>DengTa</modelName>"
            + "<modelNumber>1.0</modelNumber>"
            + "<UDN>uuid:" + uuidDevice() + "</UDN>"
            + "<dlna:X_DLNADOC xmlns:dlna=\"urn:schemas-dlna-org:device-1-0\">DMR-1.50</dlna:X_DLNADOC>"
            + "<dlna:X_DLNACAP xmlns:dlna=\"urn:schemas-dlna-org:device-1-0\">av-upload</dlna:X_DLNACAP>"
            + "<presentationURL>http://" + host + ":" + HTTP_PORT + "/</presentationURL>"
            + "<iconList>"
            + "<icon>"
            + "<mimetype>image/png</mimetype>"
            + "<width>48</width><height>48</height><depth>24</depth>"
            + "<url>/icon.png</url>"
            + "</icon>"
            + "</iconList>"
            + "<serviceList>"
            + serviceEntry("urn:schemas-upnp-org:service:AVTransport:1",
                "AVTransport", "/avt", "/avt/event", "/avt",
                "SetAVTransportURI,Play,Pause,Stop,Seek,GetTransportInfo,GetPositionInfo,"
                    + "Next,Previous,GetTransportSettings,GetDeviceCapabilities,"
                    + "GetCurrentTransportActions")
            + serviceEntry("urn:schemas-upnp-org:service:ConnectionManager:1",
                "ConnectionManager", "/cm", "/cm/event", "/cm",
                "GetProtocolInfo,GetCurrentConnectionIDs,GetCurrentConnectionInfo")
            + serviceEntry("urn:schemas-upnp-org:service:RenderingControl:1",
                "RenderingControl", "/rc", "/rc/event", "/rc",
                "GetVolume,SetVolume,GetMute,SetMute")
            + "</serviceList>"
            + "</device></root>";
    }

    private String serviceEntry(String type, String id, String control,
                                String event, String scpd, String actions) {
        return "<service>"
            + "<serviceType>" + type + "</serviceType>"
            + "<serviceId>urn:upnp-org:serviceId:" + id + "</serviceId>"
            + "<controlURL>" + control + "</controlURL>"
            + "<eventSubURL>" + event + "</eventSubURL>"
            + "<SCPDURL>" + scpd + "</SCPDURL>"
            + "</service>";
    }

    // ---------------------------------------------------------------- 工具

    private String readOrCreateDeviceId() {
        SharedPreferences prefs = prefs(this);
        String id = prefs.getString(DEVICE_ID_KEY, "");
        if (id.isEmpty()) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString(DEVICE_ID_KEY, id).apply();
        }
        return id;
    }

    private String uuidDevice() {
        return deviceId.isEmpty() ? readOrCreateDeviceId() : deviceId;
    }

    private String localIpAddress() {
        return advertisedAddress;
    }

    private String findLocalIpAddress() {
        try {
            String wifiIp = "";
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface iface = interfaces.nextElement();
                if (!iface.isUp() || iface.isLoopback()) continue;
                Enumeration<InetAddress> addresses = iface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address.isLoopbackAddress()) continue;
                    boolean ipv4 = address.getHostAddress() != null
                        && address.getHostAddress().contains(".");
                    if (!ipv4 || !address.isSiteLocalAddress()) continue;
                    String ip = address.getHostAddress();
                    // 优先返回 Wi-Fi 接口（wlan/wifi）的 IP，避免 VPN 干扰
                    String name = iface.getName().toLowerCase(Locale.ROOT);
                    if (name.contains("wlan") || name.contains("wifi") || name.contains("eth")) {
                        return ip;
                    }
                    if (wifiIp.isEmpty()) wifiIp = ip;
                }
            }
            return wifiIp;
        } catch (Exception ignored) {
        }
        return "";
    }

    private String findTag(String xml, String tagName) {
        try {
            // 去除 namespace：剥掉标签前缀（<u:SetAVTransportURI> → <SetAVTransportURI>）
            // 和 xmlns 属性（留着也无妨，但剥掉更干净）
            String clean = xml
                .replaceAll("<\\w+:", "<")      // 开始标签前缀：<u:Tag → <Tag
                .replaceAll("</\\w+:", "</")    // 结束标签前缀：</u:Tag → </Tag
                .replaceAll("\\s+xmlns:?[\\w-]*=\"[^\"]*\"", ""); // xmlns="..." / xmlns:u="..."
            int start = clean.indexOf("<" + tagName + ">");
            if (start < 0) start = clean.indexOf("<" + tagName + " ");
            if (start < 0) return "";
            int gt = clean.indexOf(">", start);
            if (gt < 0) return "";
            int end = clean.indexOf("</" + tagName + ">", gt);
            if (end < 0) return "";
            return clean.substring(gt + 1, end).trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.append((char) value);
            if (line.length() > 8192) break;
        }
        return line.length() == 0 && value == -1 ? null : line.toString();
    }

    private byte[] readBody(InputStream input, int contentLength) throws IOException {
        // 优先按 Content-Length 精确读取，避免 keep-alive 连接下等 EOF 卡住
        if (contentLength == 0) return new byte[0];
        if (contentLength > 0) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[Math.min(4096, contentLength)];
            int remaining = contentLength;
            try {
                while (remaining > 0) {
                    int read = input.read(chunk, 0, Math.min(chunk.length, remaining));
                    if (read < 0) break;
                    buffer.write(chunk, 0, read);
                    remaining -= read;
                }
            } catch (SocketTimeoutException ignored) {
            }
            return buffer.toByteArray();
        }
        // 无 Content-Length 时兜底读到流结束（带超时）
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[2048];
        int read;
        try {
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
                if (buffer.size() > 1_000_000) break;
            }
        } catch (SocketTimeoutException ignored) {
        }
        return buffer.toByteArray();
    }

    private void writeHttpResponse(OutputStream output, String status, String contentType,
                                   byte[] body) throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append("\r\n");
        head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        output.write(head.toString().getBytes(StandardCharsets.UTF_8));
        output.write(body);
        output.flush();
    }

    private void closeQuietly(AutoCloseable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (Exception ignored) {
        }
    }

    private void publishReceivedMedia(String uri, String meta) {
        String title = extractTitleFromMeta(meta);
        // 先持久化待处理媒体，确保即使前端暂时错过广播也能恢复
        try {
            prefs(this).edit()
                .putString(PENDING_URI_KEY, uri == null ? "" : uri)
                .putString(PENDING_TITLE_KEY, title == null ? "" : title)
                .putString(PENDING_META_KEY, meta == null ? "" : meta)
                .apply();
        } catch (Exception ignored) {
        }
        Intent intent = new Intent(MEDIA_RECEIVED_ACTION);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_URI, uri);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_META_JSON, meta);
        sendBroadcast(intent);
        Log.i("DlnaReceiverService", "publishReceivedMedia: title=" + title
            + " uri=" + maskUri(uri));
    }

    /** 日志脱敏：隐藏 URL 的签名参数，避免泄漏可播放地址。 */
    private String maskUri(String uri) {
        if (uri == null || uri.isEmpty()) return "";
        try {
            java.net.URI parsed = new java.net.URI(uri);
            String query = parsed.getQuery();
            if (query == null || query.isEmpty()) return uri;
            StringBuilder sb = new StringBuilder();
            for (String pair : query.split("&")) {
                if (sb.length() > 0) sb.append('&');
                int eq = pair.indexOf('=');
                String name = eq > 0 ? pair.substring(0, eq) : pair;
                if (isSensitiveParam(name)) {
                    sb.append(name).append("=***");
                } else {
                    sb.append(pair);
                }
            }
            String base = uri;
            String scheme = parsed.getScheme();
            String host = parsed.getHost();
            String path = parsed.getPath();
            if (scheme != null && host != null && path != null) {
                base = scheme + "://" + host + path;
            }
            return base + "?" + sb;
        } catch (Exception e) {
            return "(" + uri.length() + " bytes)";
        }
    }

    private boolean isSensitiveParam(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.contains("sig") || lower.contains("sign") || lower.contains("token")
            || lower.contains("key") || lower.contains("secret") || lower.contains("pass")
            || lower.contains("deadline") || lower.contains("expires");
    }

    private String extractTitleFromMeta(String meta) {
        if (meta == null || meta.isEmpty()) return "";
        // findTag 内部会剥 namespace 前缀，所以 dc:title 剥后就成 <title>，直接搜 title 即可
        String like = unescapeXml(findTag(meta, "title"));
        if (like.isEmpty()) {
            // 兜底：直接在原文里找 dc:title 或 <title> 的内容
            int titleStart = meta.indexOf("dc:title");
            if (titleStart < 0) titleStart = meta.indexOf("<title>");
            if (titleStart >= 0) {
                int gt = meta.indexOf(">", titleStart);
                if (gt >= 0) {
                    int end = meta.indexOf("<", gt);
                    if (end > gt) like = unescapeXml(meta.substring(gt + 1, end).trim());
                }
            }
        }
        return like;
    }

    /** XML 实体反转义：SOAP/XML 里 &amp; &lt; &gt; &quot; &apos; 还原为原文（视频签名 URL 必须还原 &）。 */
    private String unescapeXml(String input) {
        if (input == null || input.isEmpty()) return input == null ? "" : input;
        StringBuilder result = null;
        int start = 0;
        int amp;
        while ((amp = input.indexOf('&', start)) >= 0) {
            int semi = input.indexOf(';', amp);
            if (semi < 0 || semi - amp > 10) {
                // 不是完整的实体，保留原样并继续
                start = amp + 1;
                continue;
            }
            if (result == null) result = new StringBuilder(input.length());
            result.append(input, start, amp);
            String entity = input.substring(amp + 1, semi);
            switch (entity) {
                case "amp": result.append('&'); break;
                case "lt": result.append('<'); break;
                case "gt": result.append('>'); break;
                case "quot": result.append('"'); break;
                case "apos": result.append('\''); break;
                default:
                    // 数字实体（&#38; 等）
                    if (entity.startsWith("#x") || entity.startsWith("#X")) {
                        try {
                            result.append((char) Integer.parseInt(entity.substring(2), 16));
                        } catch (NumberFormatException ignored) {
                            result.append(entity);
                        }
                    } else if (entity.startsWith("#")) {
                        try {
                            result.append((char) Integer.parseInt(entity.substring(1)));
                        } catch (NumberFormatException ignored) {
                            result.append(entity);
                        }
                    } else {
                        result.append('&').append(entity).append(';');
                    }
                    break;
            }
            start = semi + 1;
        }
        if (result == null) return input;
        if (start < input.length()) result.append(input, start, input.length());
        return result.toString();
    }

    /** 异常消息安全取值（避免 getMessage()==null 拼出 "null" 或 NPE）。 */
    private String safeMsg(Throwable t) {
        if (t == null) return "unknown";
        String m = t.getMessage();
        return m == null || m.isEmpty() ? "unknown (" + t.getClass().getSimpleName() + ")" : m;
    }

    /** XML 实体转义：`&` `<` `>` `"` `'` 编码为 `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`。用于嵌入 XML 响应。 */
    private String escapeXml(String input) {
        if (input == null || input.isEmpty()) return input == null ? "" : input;
        StringBuilder sb = new StringBuilder(input.length());
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            switch (c) {
                case '&': sb.append("&amp;"); break;
                case '<': sb.append("&lt;"); break;
                case '>': sb.append("&gt;"); break;
                case '"': sb.append("&quot;"); break;
                case '\'': sb.append("&apos;"); break;
                default: sb.append(c); break;
            }
        }
        return sb.toString();
    }

    private void broadcastState() {
        Intent intent = new Intent(ACTION_STATE);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_STATE, discovery.snapshot().active ? "running" : "stopped");
        sendBroadcast(intent);
        mainHandler.post(() -> { if (running) installForegroundNotification(); });
    }

    private void installForegroundNotification() {
        try {
            DlnaDiscovery.Snapshot status = discovery.snapshot();
            Intent stopIntent = stopIntent(this);
            PendingIntent stopPending = PendingIntent.getService(
                this, 0, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(status.active ? "灯塔投屏已开启"
                    : status.errorCode.isEmpty() ? "灯塔投屏正在启动" : "灯塔投屏暂不可发现")
                .setContentText(status.active
                    ? "视频 App 里点投屏，选择「灯塔 DENGTA」即可一起看"
                    : status.errorCode.isEmpty() ? "正在连接局域网并注册接收器"
                    : "请检查局域网连接后重试（" + status.errorCode + "）")
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(0, "停止投屏", stopPending)
                .setOngoing(true);
            Intent openIntent = getPackageManager().getLaunchIntentForPackage(
                getPackageName());
            if (openIntent != null) {
                PendingIntent openPending = PendingIntent.getActivity(
                    this, 0, openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                builder.setContentIntent(openPending);
            }
            startForeground(NOTIFICATION_ID, builder.build());
        } catch (Exception ignored) {
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "灯塔投屏",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("接收视频 App 投屏到灯塔");
        NotificationManager manager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void publishDebug(String message) {
        android.util.Log.d("DlnaReceiverService", message);
    }

    private void threadPoolExecutorSafe(Runnable task) {
        try {
            Thread thread = new Thread(task, "dengta-dlna-client");
            thread.setDaemon(true);
            thread.start();
        } catch (Exception ignored) {
        }
    }
}
