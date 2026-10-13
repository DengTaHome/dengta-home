package home.dengta.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

public final class CoWatchReplyReceiver extends BroadcastReceiver {
    static final String ACTION_REPLY = "home.dengta.app.co_watch.REPLY";
    static final String REMOTE_INPUT_TEXT = "co_watch_reply_text";
    static final String EXTRA_SESSION_ID = "co_watch_session_id";
    static final String EXTRA_CONVERSATION_ID = "co_watch_conversation_id";
    static final String EXTRA_TITLE = "co_watch_title";
    static final String EXTRA_MEDIA_POSITION_SECONDS =
        "co_watch_media_position_seconds";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_REPLY.equals(intent.getAction())) return;
        Bundle input = RemoteInput.getResultsFromIntent(intent);
        CharSequence value = input == null
            ? null
            : input.getCharSequence(REMOTE_INPUT_TEXT);
        String text = value == null
            ? ""
            : cleanText(value.toString(), 1200);
        String sessionId = cleanText(
            intent.getStringExtra(EXTRA_SESSION_ID),
            100
        );
        if (text.isEmpty() || sessionId.isEmpty()) return;

        String conversationId = cleanText(
            intent.getStringExtra(EXTRA_CONVERSATION_ID),
            100
        );
        int mediaPositionSeconds = Math.max(
            -1,
            intent.getIntExtra(EXTRA_MEDIA_POSITION_SECONDS, -1)
        );
        String requestId = UUID.randomUUID().toString();
        Data data = new Data.Builder()
            .putString(CoWatchReplyWorker.DATA_SESSION_ID, sessionId)
            .putString(
                CoWatchReplyWorker.DATA_CONVERSATION_ID,
                conversationId
            )
            .putInt(
                CoWatchReplyWorker.DATA_MEDIA_POSITION_SECONDS,
                mediaPositionSeconds
            )
            .putString(CoWatchReplyWorker.DATA_TEXT, text)
            .putString(CoWatchReplyWorker.DATA_REQUEST_ID, requestId)
            .build();
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(
            CoWatchReplyWorker.class
        )
            .setInputData(data)
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                10,
                TimeUnit.SECONDS
            )
            .addTag("dengta-co-watch-reply")
            .build();
        Context appContext = context.getApplicationContext();
        WorkManager.getInstance(appContext).enqueue(request);
    }

    private static String cleanText(String value, int limit) {
        String normalized = value == null ? "" : value.trim();
        return normalized.length() <= limit
            ? normalized
            : normalized.substring(0, limit);
    }
}
