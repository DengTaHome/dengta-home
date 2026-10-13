import { sampleLargeTextFile } from './large-text-file.js';

export function readLargeTextSample(file, { signal, onProgress, maximumCharacters = 60000 } = {}) {
  if (typeof Worker === 'undefined') return sampleLargeTextFile(file, { signal, onProgress, maximumCharacters });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./large-text-worker.js', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate(); signal?.removeEventListener('abort', abort);
    };
    const abort = () => { stop(); reject(Object.assign(new Error('文件读取已取消，原材料仍保留。'), { code: 'import_cancelled' })); };
    worker.onmessage = ({ data }) => {
      if (data.progress) { onProgress?.(data.progress); return; }
      stop();
      if (data.error) reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
      else resolve(data.parsed);
    };
    worker.onerror = () => { stop(); reject(Object.assign(new Error('文件读取失败，请另存为 UTF-8 文本后重试。'), { code: 'import_read_failed' })); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.postMessage({ file, maximumCharacters });
  });
}
