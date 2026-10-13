import { fingerprintImportFile } from "./import-file-fingerprint.js";

export function readImportFingerprint(file,{signal,onProgress}={}) {
  if(typeof Worker === "undefined")return fingerprintImportFile(file,{signal,onProgress});
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./import-file-fingerprint-worker.js",import.meta.url),{type:"module"});
    const stop=()=>{worker.terminate();signal?.removeEventListener("abort",abort);};
    const abort=()=>{stop();reject(Object.assign(new Error("文件检查已取消，可以重新选择原文件继续。"),{code:"import_cancelled"}));};
    worker.onmessage=({data})=>{
      if(data.progress){onProgress?.(data.progress);return;}
      stop();
      if(data.error || !/^[a-f0-9]{64}$/.test(data.fingerprint || ""))reject(Object.assign(new Error("无法确认文件指纹，请检查文件格式后重试。"),{code:data.error?.code || "import_read_failed"}));
      else resolve(data.fingerprint);
    };
    worker.onerror=()=>{stop();reject(Object.assign(new Error("文件检查失败，请重新选择后重试。"),{code:"import_read_failed"}));};
    signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted){abort();return;} worker.postMessage({file});
  });
}
