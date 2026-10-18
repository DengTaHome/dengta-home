import { isPrivateMediaAssetId } from "./private-media.js";

export async function isAnimatedStickerBlob(blob) {
  if (!blob || blob.size < 30) return false;
  const bytes = new Uint8Array(await blob.slice(0, 21).arrayBuffer());
  const fourCC = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
  return fourCC(0) === "RIFF" && fourCC(8) === "WEBP" && fourCC(12) === "VP8X" && (bytes[20] & 2) !== 0;
}

export function stickerPosterPath(src) {
  const value = String(src || "");
  const match = /^\/api\/v2\/private-media\/assets\/([^/]+)\/content$/.exec(value);
  return match && isPrivateMediaAssetId(match[1]) ? `${value}?poster=1` : "";
}
