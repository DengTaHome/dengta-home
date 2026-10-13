package home.dengta.app;

/**
 * 投屏错误码与诊断工具。
 *
 * 统一管理所有投屏相关错误，提供用户可读的中文提示。
 */
public final class CastError {

    private CastError() {}

    // ----- 错误码分类 -----
    public static final int SUCCESS = 0;
    public static final int ERR_NETWORK_TIMEOUT = 1001;
    public static final int ERR_NETWORK_DNS = 1002;
    public static final int ERR_NETWORK_CONNECT = 1003;
    public static final int ERR_CDN_403 = 2001;
    public static final int ERR_CDN_404 = 2002;
    public static final int ERR_CDN_OTHER = 2003;
    public static final int ERR_FORMAT_UNSUPPORTED = 3001;
    public static final int ERR_CODEC_UNSUPPORTED = 3002;
    public static final int ERR_DRM_PROTECTED = 4001;
    public static final int ERR_HLS_KEY_FAILED = 4002;
    public static final int ERR_PROXY_START_FAILED = 5001;
    public static final int ERR_PROXY_FETCH_FAILED = 5002;
    public static final int ERR_DLNA_START_FAILED = 6001;
    public static final int ERR_UNKNOWN = 9999;

    /**
     * 将 Media3 PlaybackException errorCode 映射为用户可读的中文错误消息。
     */
    public static String formatMediaError(int media3ErrorCode) {
        switch (media3ErrorCode) {
            // 网络错误
            case 2001: // IO_NETWORK_CONNECTION_FAILED
                return "无法连接到视频服务器，请检查 Wi-Fi 网络后重试。";
            case 2002: // IO_NETWORK_CONNECTION_TIMEOUT
                return "连接视频服务器超时，请检查网络信号后重试。";
            case 2004: // IO_BAD_HTTP_STATUS
                return "视频源拒绝了请求（可能是防盗链）。\n正在尝试本地代理拉流…";
            case 2005: // IO_FILE_NOT_FOUND
                return "视频地址不存在（404），请重新投屏。";
            case 2007: // IO_CLEARTEXT_NOT_PERMITTED
                return "设备不允许播放 HTTP 视频地址。\n已自动切换到原生播放器。";

            // 格式错误
            case 3001: // PARSING_CONTAINER_MALFORMED
            case 3002: // PARSING_MANIFEST_MALFORMED
                return "视频格式损坏或解析失败。\n请尝试更换源或降低清晰度。";
            case 3003: // PARSING_CONTAINER_UNSUPPORTED
                return "视频容器格式不兼容。\n请尝试更换清晰度（如切回 1080p 以下）。";
            case 3004: // PARSING_MANIFEST_UNSUPPORTED
                return "视频流清单格式不支持。\n建议更换视频源。";

            // 解码错误
            case 4001: // DECODER_INIT_FAILED
            case 4002: // DECODER_QUERY_FAILED
            case 4003: // DECODING_FAILED
                return "设备解码失败。\n这可能是视频编码不被本机支持（如 AV1）。";
            case 4004: // DECODING_FORMAT_EXCEEDS_CAPABILITIES
                return "视频规格超出设备解码能力（如 4K HDR 10-bit）。\n请尝试降低清晰度。";
            case 4005: // DECODING_FORMAT_UNSUPPORTED
                return "视频编码格式不兼容。\n建议更换源或使用其他视频 App。";

            // DRM 错误
            case 6001: // DRM_UNSUPPORTED
                return "此视频使用了 DRM 数字版权保护，\n本设备不支持解密。";
            case 6002: // DRM_SCHEME_UNSUPPORTED
                return "此视频使用的 DRM 方案不被支持。\n请在原 App 内观看。";
            case 6003: // DRM_PROVISIONING_FAILED
                return "DRM 授权初始化失败。\n请检查设备是否支持 Widevine。";
            case 6004: // DRM_CONTENT_ERROR
                return "DRM 解密失败，内容可能已损坏。\n请尝试更换源。";
            case 6005: // DRM_LICENSE_ACQUISITION_FAILED
                return "无法获取视频播放许可证。\n请在原 App 内观看，或尝试其他视频。";
            case 6006: // DRM_DISALLOWED_OPERATION
                return "DRM 操作被拒绝。\n请尝试更换清晰度或源。";
            case 6007: // DRM_SYSTEM_ERROR
                return "DRM 系统错误。\n请重启 App 后重试。";
            case 6008: // DRM_DEVICE_REVOKED
                return "此设备的 DRM 证书已被吊销。\n请联系设备厂商。";
            case 6009: // DRM_LICENSE_EXPIRED
                return "视频播放许可证已过期。\n请在原 App 内重新加载。";

            // 默认
            default:
                if (media3ErrorCode >= 2000 && media3ErrorCode < 3000) {
                    return "网络请求错误（" + media3ErrorCode + "）。\n请检查网络后重试。";
                }
                if (media3ErrorCode >= 4000 && media3ErrorCode < 5000) {
                    return "解码错误（" + media3ErrorCode + "）。\n请尝试更换清晰度或源。";
                }
                return "播放失败（" + media3ErrorCode + "）。\n建议重新投屏。";
        }
    }

    /** 检测 URL 是否可能是 DRM 加密内容。 */
    public static boolean isLikelyDrm(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        return lower.contains("widevine") || lower.contains("drm")
            || lower.contains("license") || lower.contains("加密")
            || lower.contains("encrypt") || lower.contains("cenc");
    }

    /** 检测 URL 是否可能是 HLS AES-128 加密流。 */
    public static boolean isLikelyHlsEncrypted(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        // 只有 m3u8 + 明显加密关键词才判为加密，避免所有 m3u8 误判
        if (!lower.contains(".m3u8") && !lower.contains("m3u8")) return false;
        return lower.contains("enc") || lower.contains("key=key")
            || lower.contains("encrypted") || lower.contains("aes")
            || lower.contains("method=aes");
    }

    /** 获取 DRM 加密内容的用户提示。 */
    public static String drmErrorMessage() {
        return "该内容受 DRM 数字版权保护，无法直接播放。\n" +
               "请在原 App 内观看，或尝试其他无保护的内容。";
    }

    /** 获取 HLS 加密流预测提示。 */
    public static String hlsEncryptedHint() {
        return "该视频流可能已加密，正在尝试解密播放…\n" +
               "如果播放失败，请尝试更换源。";
    }

    /** 构建诊断信息，用于调试连接问题。 */
    public static String buildDiagnosticInfo(String url, String domain, int proxyPort,
                                              boolean dlnaActive, String transportState) {
        StringBuilder sb = new StringBuilder();
        sb.append("===== 投屏诊断信息 =====\n");
        sb.append("URL: ").append(url != null ? maskUrl(url) : "null").append("\n");
        sb.append("域名: ").append(domain != null ? domain : "null").append("\n");
        sb.append("代理端口: ").append(proxyPort > 0 ? proxyPort : "未启动").append("\n");
        sb.append("DLNA 接收器: ").append(dlnaActive ? "运行中" : "未启动").append("\n");
        sb.append("传输状态: ").append(transportState != null ? transportState : "未知").append("\n");
        sb.append("=========================");
        return sb.toString();
    }

    /** 脱敏 URL（隐藏签名参数）。 */
    private static String maskUrl(String url) {
        try {
            java.net.URI uri = new java.net.URI(url);
            String query = uri.getQuery();
            if (query == null) return url;
            String scheme = uri.getScheme() != null ? uri.getScheme() : "";
            String host = uri.getHost() != null ? uri.getHost() : "";
            String path = uri.getPath() != null ? uri.getPath() : "";
            StringBuilder masked = new StringBuilder();
            masked.append(scheme).append("://").append(host).append(path).append("?");
            for (String param : query.split("&")) {
                if (param.startsWith("deadline=") || param.startsWith("sign=")
                    || param.startsWith("sig=") || param.startsWith("token=")
                    || param.startsWith("upsig=") || param.startsWith("uipk=")
                    || param.startsWith("key=") || param.startsWith("secret=")) {
                    masked.append(param.split("=")[0]).append("=***&");
                } else {
                    masked.append(param).append("&");
                }
            }
            return masked.toString().replaceAll("&$", "");
        } catch (Exception e) {
            return url;
        }
    }
}