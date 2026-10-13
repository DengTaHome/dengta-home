package home.dengta.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

/** 音频焦点助手：投屏播放开始时请求焦点，避免与其他音源冲突（简化为一次性请求/释放）。 */
final class AudioFocusHelper {

    private final AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private Object focusListener;
    private boolean hasFocus = false;

    AudioFocusHelper(Context context) {
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    void requestFocus() {
        if (audioManager == null || hasFocus) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build();
            focusListener = new AudioManager.OnAudioFocusChangeListener() {
                @Override
                public void onAudioFocusChange(int focusChange) {
                    // 失去焦点（来电/其他播放器）时不做自动处理，保持后台播放；用户可手动停止
                }
            };
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener((AudioManager.OnAudioFocusChangeListener) focusListener)
                .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            //noinspection deprecation
            audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        hasFocus = true;
    }

    void abandonFocus() {
        if (audioManager == null || !hasFocus) {
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                //noinspection deprecation
                audioManager.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {
        }
        hasFocus = false;
    }
}