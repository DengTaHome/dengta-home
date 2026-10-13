export const MAX_PLAYLIST_TEXT_LENGTH = 1024 * 1024;

const PLAYLIST_EXTENSION = /\.(?:json|m3u|m3u8|txt)$/i;
const PLAYLIST_MIME = new Set(["", "application/json", "text/plain", "audio/x-mpegurl", "application/x-mpegurl", "application/vnd.apple.mpegurl"]);
const AUDIO_SIGNATURES = [
  (bytes) => bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33,
  (bytes) => bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0,
  (bytes) => String.fromCharCode(...bytes.slice(0, 4)) === "OggS",
  (bytes) => String.fromCharCode(...bytes.slice(0, 4)) === "fLaC",
  (bytes) => String.fromCharCode(...bytes.slice(0, 4)) === "RIFF",
  (bytes) => String.fromCharCode(...bytes.slice(4, 8)) === "ftyp",
];

export async function readPlaylistTextFile(file) {
  if (!PLAYLIST_EXTENSION.test(String(file?.name || ""))) throw new Error("歌单文件仅支持 JSON、M3U、M3U8 或 TXT，音频请使用“选择本机音频”。");
  const mime = String(file?.type || "").toLowerCase().split(";", 1)[0];
  if (!PLAYLIST_MIME.has(mime)) throw new Error("文件类型不是受支持的文本歌单，未读取文件内容。");
  if (!Number.isFinite(file?.size) || file.size <= 0) throw new Error("歌单文件为空或大小无效。");
  if (file.size > MAX_PLAYLIST_TEXT_LENGTH) throw new Error("歌单文件不能超过 1 MiB，未读取文件内容。");
  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (AUDIO_SIGNATURES.some((matches) => matches(header))) throw new Error("检测到音频文件头；请改用“选择本机音频”，该文件不会读入文本框。");
  const controls = header.filter((byte) => byte === 0 || (byte < 9 || (byte > 13 && byte < 32))).length;
  if (header.includes(0) || controls > Math.max(4, header.length * 0.05)) throw new Error("检测到二进制内容，未读取文件内容。");
  const value = await file.text();
  if (value.length > MAX_PLAYLIST_TEXT_LENGTH) throw new Error("歌单文本不能超过 1 MiB。");
  return value;
}
