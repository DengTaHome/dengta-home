import { sampleLargeTextFile } from './large-text-file.js';

self.onmessage = async ({ data }) => {
  try {
    const parsed = await sampleLargeTextFile(data.file, {
      maximumCharacters: data.maximumCharacters,
      onProgress: progress => self.postMessage({ progress }),
    });
    self.postMessage({ parsed });
  } catch (error) {
    self.postMessage({ error: { code: error.code, message: error.message } });
  }
};
