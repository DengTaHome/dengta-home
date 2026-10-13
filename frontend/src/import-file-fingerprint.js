import { sha256 } from "@noble/hashes/sha2.js";
import { validateLargeTextFile, textFileEncoding } from "./large-text-file.js";

export async function fingerprintImportFile(file, { signal, onProgress } = {}) {
  validateLargeTextFile(file);
  signal?.throwIfAborted();
  await textFileEncoding(file);
  const hash=sha256.create(); let lastReport=0;
  try {
    for(let start=0;start<file.size;start+=1024*1024) {
      signal?.throwIfAborted();
      const end=Math.min(file.size,start+1024*1024);
      const bytes=new Uint8Array(await file.slice(start,end).arrayBuffer());
      signal?.throwIfAborted(); hash.update(bytes);
      const now=Date.now();
      if(end===file.size || now-lastReport>=100) { onProgress?.({readBytes:end,totalBytes:file.size});lastReport=now; }
    }
    return Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,"0")).join("");
  } finally { hash.destroy(); }
}
