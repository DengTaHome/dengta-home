import { fingerprintImportFile } from "./import-file-fingerprint.js";
self.onmessage=async ({data})=>{
  try {
    const fingerprint=await fingerprintImportFile(data.file,{onProgress:progress=>self.postMessage({progress})});
    self.postMessage({fingerprint});
  } catch(error) { self.postMessage({error:{code:error.code || "import_read_failed"}}); }
};
