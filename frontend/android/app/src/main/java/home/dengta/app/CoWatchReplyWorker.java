package home.dengta.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class CoWatchReplyWorker extends Worker {
    static final String DATA_SESSION_ID = "session_id";
    static final String DATA_CONVERSATION_ID = "conversation_id";
    static final String DATA_MEDIA_POSITION_SECONDS =
        "media_position_seconds";
    static final String DATA_TEXT = "text";
    static final String DATA_REQUEST_ID = "request_id";
    private static final int HTTP_TIMEOUT_MS = 70_000;
    private static final int MAX_ATTEMPTS = 4;

    public CoWatchReplyWorker(
        @NonNull Context context,
        @NonNull WorkerParameters params
    ) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (isStopped()) return Result.success();
        Context context = getApplicationContext();
        String sessionId = cleanText(
            getInputData().getString(DATA_SESSION_ID),
            100
        );
        String conversationId = cleanText(
            getInputData().getString(DATA_CONVERSATION_ID),
            100
        );
        String text = cleanText(getInputData().getString(DATA_TEXT), 1200);
        String requestId = cleanText(
            getInputData().getString(DATA_REQUEST_ID),
            100
        );
        int mediaPositionSeconds = Math.max(
            -1,
            getInputData().getInt(DATA_MEDIA_POSITION_SECONDS, -1)
        );
        if (sessionId.isEmpty() || text.isEmpty() || requestId.isEmpty()) {
            return Result.failure();
        }

        BackgroundNotificationCredentials.Identity identity =
            BackgroundNotificationCredentials.read(context);
        if (identity == null || identity.isExpired(System.currentTimeMillis())) {
            return Result.success();
        }
        String requestScope = identity.userId + ":" + identity.companionId;
        if (
            !requestScope.equals(
                BackgroundNotificationCredentials.currentScopeKey(context)
            )
        ) {
            return Result.success();
        }

        try {
            HttpResponse httpResponse = postReply(
                context,
                identity,
                sessionId,
                text,
                requestId,
                mediaPositionSeconds
            );
            if (httpResponse.status < 200 || httpResponse.status >= 300) {
                return isRetryableStatus(httpResponse.status)
                    ? retryOrFail()
                    : Result.failure();
            }
            if (isStopped() || !requestScope.equals(
                BackgroundNotificationCredentials.currentScopeKey(context)
            )) {
                return Result.success();
            }
            notifyReply(
                context,
                httpResponse.body,
                conversationId,
                sessionId,
                mediaPositionSeconds
            );
            return Result.success();
        } catch (IOException error) {
            return retryOrFail();
        } catch (Exception error) {
            return Result.failure();
        }
    }

    private Result retryOrFail() {
        return getRunAttemptCount() + 1 < MAX_ATTEMPTS
            ? Result.retry()
            : Result.failure();
    }

    private static boolean isRetryableStatus(int status) {
        return status == 429 || status >= 500;
    }

    private static HttpResponse postReply(
        Context context,
        BackgroundNotificationCredentials.Identity identity,
        String sessionId,
        String text,
        String requestId,
        int mediaPositionSeconds
    ) throws Exception {
        String baseUrl = context.getString(R.string.backend_api_url)
            .replaceAll("/+$", "");
        String encodedSessionId = URLEncoder.encode(
            sessionId,
            StandardCharsets.UTF_8.name()
        );
        URI uri = URI.create(
            baseUrl + "/api/v2/co-watch/sessions/" + encodedSessionId + "/reply"
        );
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalStateException("co_watch_reply_requires_https");
        }

        JSONObject request = new JSONObject();
        request.put("text", text);
        request.put("request_id", requestId);
        if (mediaPositionSeconds >= 0) {
            request.put("media_position_seconds", mediaPositionSeconds);
        }
        byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) uri.toURL()
            .openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(HTTP_TIMEOUT_MS);
            connection.setReadTimeout(HTTP_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty(
                "X-DengTa-Installation-Token",
                identity.installationToken
            );
            connection.setRequestProperty(
                "X-DengTa-Companion-Id",
                identity.companionId
            );
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            return new HttpResponse(status, readStream(stream));
        } finally {
            connection.disconnect();
        }
    }

    private static void notifyReply(
        Context context,
        String responseBody,
        String conversationId,
        String sessionId,
        int mediaPositionSeconds
    ) throws Exception {
        JSONObject response = new JSONObject(responseBody);
        JSONObject notification = response.optJSONObject("notification");
        JSONObject assistant = response.optJSONObject("assistant_message");
        String reaction = cleanText(response.optString("reaction", ""), 420);
        String messageId = cleanText(
            notification == null
                ? (assistant == null ? "" : assistant.optString("id", ""))
                : notification.optString("message_id", ""),
            100
        );
        String title = cleanText(
            notification == null
                ? "一起看"
                : notification.optString("title", "一起看"),
            50
        );
        String body = cleanText(
            notification == null
                ? reaction
                : notification.optString("body", reaction),
            420
        );
        if (messageId.isEmpty() || body.isEmpty()) return;
        PushNotificationWorker.showImmediateCoWatchMessage(
            context,
            title,
            messageId,
            conversationId,
            sessionId,
            body,
            mediaPositionSeconds
        );
    }

    private static String readStream(InputStream stream) throws IOException {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8)
            )
        ) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String cleanText(String value, int limit) {
        String normalized = value == null ? "" : value.trim();
        return normalized.length() <= limit
            ? normalized
            : normalized.substring(0, limit);
    }

    private static final class HttpResponse {
        final int status;
        final String body;

        HttpResponse(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }
}
