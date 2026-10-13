import { registerPlugin } from "@capacitor/core";

/**
 * VideoExtractor — Web 视频流提取器插件。
 *
 * 调用原生 VideoExtractorActivity，打开 WebView 加载网页，
 * 注入 JS 提取视频流，自动交给 ExoPlayer 播放。
 */
export const VideoExtractor = registerPlugin("VideoExtractor");