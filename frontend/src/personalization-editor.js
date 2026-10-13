export const PERSONALIZATION_TEXT_FILE_ACCEPT = ".txt,.text,.md,.markdown,text/plain";

const characterSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
  : null;

export function countPersonalizationCharacters(value) {
  const text = String(value ?? "");
  let count = 0;
  const iterator = (characterSegmenter ? characterSegmenter.segment(text) : text)[Symbol.iterator]();
  while (!iterator.next().done) {
    count += 1;
  }
  return count;
}

export function countPersonalizationCharactersCooperatively(value, isCancelled) {
  const text = String(value ?? "");
  const iterator = (characterSegmenter ? characterSegmenter.segment(text) : text)[Symbol.iterator]();
  let count = 0;
  return new Promise((resolve) => {
    const step = () => {
      if (isCancelled()) { resolve(null); return; }
      for (let index = 0; index < 4096; index += 1) {
        if (iterator.next().done) { resolve(count); return; }
        count += 1;
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

export function appendPersonalizationText(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  return `${current}\n\n${incoming}`;
}

export async function readPersonalizationTextFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("未读取到文本文件，请重新选择。");
  }
  if (!/\.(txt|text|md|markdown)$/i.test(file.name || "") && file.type !== "text/plain") {
    throw new Error("请选择纯文本文件（TXT 或 Markdown）。");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]))
    || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    || (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) {
    throw new Error("文件内容是文档或压缩包，请先另存为纯文本。");
  }
  const codecs = bytes[0] === 0xff && bytes[1] === 0xfe ? ["utf-16le"]
    : bytes[0] === 0xfe && bytes[1] === 0xff ? ["utf-16be"]
      : ["utf-8", "gb18030"];
  for (const encoding of codecs) {
    let text;
    try {
      // Preserve every decoded character, including a leading BOM and whitespace.
      text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      continue;
    }
    if (text.includes("\0")) {
      throw new Error("文件包含二进制数据，请先另存为纯文本。");
    }
    return text;
  }
  throw new Error("无法完整读取文本编码，请另存为 UTF-8 后重试。");
}
