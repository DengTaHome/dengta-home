import { isPrivateMediaAssetId } from "./private-media.js";

const STICKER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const UPLOAD_ERRORS = {
  private_media_animation_too_complex: "动图帧数或累计像素过大，请缩小尺寸或精简到 240 帧以内。",
  private_media_processing_timeout: "图片处理超时，请缩小尺寸或减少动图帧数后再试。",
  private_media_too_large: "图片或转换结果超过 12MB，请压缩后再上传。",
  private_media_type_mismatch: "文件声明格式与真实图片不一致，请重新导出为 GIF、WebP、PNG 或 JPG。",
  private_media_decode_failed: "图片损坏、尺寸过大或无法解码，请重新导出后再试。",
};
export function filterStickerShelf(assets, query = "") {
  const words = String(query).normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return (Array.isArray(assets) ? assets : []).filter(asset => asset?.purpose === "custom_sticker" &&
    words.every(word => [asset.display_name, asset.alt_text, ...(asset.mood_tags || [])]
      .join(" ").normalize("NFKC").toLocaleLowerCase().includes(word)));
}

export async function importStickerFiles(files, { upload, isCurrent = () => true, onConfirmed = () => {} } = {}) {
  const results = [];
  for (const file of Array.from(files || [])) {
    if (!isCurrent()) throw new DOMException("表情包导入已取消。", "AbortError");
    const name = String(file?.name || "未命名图片");
    if (!STICKER_TYPES.has(file?.type)) {
      results.push({ name, ok: false, code: "sticker_format_unsupported", message: "目前支持 JPG、PNG、WebP 和 GIF，请重新导出为这些格式。" });
      continue;
    }
    try {
      const receipt = await upload({ image: file, purpose: "custom_sticker", displayName: name.replace(/\.[^.]+$/u, "").slice(0, 100) });
      if (!isCurrent()) throw new DOMException("表情包导入已取消。", "AbortError");
      if (receipt?.ok === false || !isPrivateMediaAssetId(receipt?.asset?.id) || receipt.asset.purpose !== "custom_sticker") {
        throw Object.assign(new Error("表情包保存回执无效。"), { code: "private_media_receipt_invalid" });
      }
      onConfirmed(receipt.asset);
      results.push({ name, ok: true });
    } catch (error) {
      if (!isCurrent() || error?.name === "AbortError") throw error;
      results.push({ name, ok: false, code: String(error?.code || "private_media_request_failed"),
        message: UPLOAD_ERRORS[error?.code] || "这张图片未确认保存。请先刷新目录核对，再单独重试。" });
    }
  }
  return results;
}
