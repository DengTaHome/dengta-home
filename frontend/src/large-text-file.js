export const LARGE_TEXT_FILE_MAX_BYTES = 1024 ** 3;
export const TEXT_FILE_EXTENSIONS = new Set(['txt','text','md','markdown','log','json','jsonl','ndjson','csv','tsv','html','htm','srt','vtt','xml','yaml','yml','eml','mbox','ini','conf']);
export const LARGE_TEXT_FILE_ACCEPT = [...TEXT_FILE_EXTENSIONS].map(ext=>'.'+ext).join(',');
const CHUNK_BYTES = 1024 * 1024;

function fail(code,message) { return Object.assign(new Error(message),{code}); }
export function isTextFile(file) { return TEXT_FILE_EXTENSIONS.has(String(file?.name||'').split('.').pop().toLowerCase()); }
export function validateLargeTextFile(file) {
  if (!file?.size) throw fail('import_empty','文件为空，请重新选择。');
  if (file.size > LARGE_TEXT_FILE_MAX_BYTES) throw fail('import_file_too_large','单个聊天文本文件最多支持 1GB。');
  if (!isTextFile(file)) throw fail('import_file_type_unsupported','这个文件不是聊天文本，请使用对应的文档解析入口。');
}
export async function textFileEncoding(file) {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size,65536)).arrayBuffer());
  if ((bytes[0]===0x50&&bytes[1]===0x4b)||(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44)||(bytes[0]===0xd0&&bytes[1]===0xcf)) {
    throw fail('import_binary_disguised','文件内容是压缩包、PDF 或 Word 文档，不能按聊天文本读取，请使用真实扩展名。');
  }
  if (bytes[0]===0xff&&bytes[1]===0xfe) return 'utf-16le';
  if (bytes[0]===0xfe&&bytes[1]===0xff) return 'utf-16be';
  if (bytes.includes(0)) throw fail('import_binary_disguised','文件包含二进制数据，无法作为聊天文本读取。');
  for (const encoding of ['utf-8','gb18030']) {
    try { new TextDecoder(encoding,{fatal:true}).decode(bytes,{stream:file.size>bytes.length});return encoding; } catch { /* try the next supported encoding */ }
  }
  throw fail('import_invalid_encoding','无法识别文本编码，请另存为 UTF-8 后重试。');
}

function encodedLineStarts(raw,codec,startByte) {
  const unit=codec.startsWith('utf-16')?2:1;
  const codeAt=index=>unit===1?raw[index]:codec==='utf-16le'?raw[index]+raw[index+1]*256:raw[index]*256+raw[index+1];
  const decoder=new TextDecoder(codec,{fatal:true});
  const starts=[{characterOffset:0,byteOffset:startByte}];
  let decoded=0,previous=0;
  for(let index=0;index+unit<=raw.length;index+=unit) {
    const code=codeAt(index);
    if(code!==10&&code!==13)continue;
    let end=index+unit;
    if(code===13&&end+unit<=raw.length&&codeAt(end)===10){end+=unit;index+=unit;}
    decoded+=decoder.decode(raw.subarray(previous,end),{stream:true}).length;
    starts.push({characterOffset:decoded,byteOffset:startByte+end});previous=end;
  }
  return starts;
}

// Each batch ends at an encoding boundary and exposes a resumable byte offset.
export async function* readTextFileBatches(file,{startByte=0,chunkBytes=CHUNK_BYTES,encoding,signal,onProgress,includeLineOffsets=false}={}) {
  validateLargeTextFile(file);
  const codec=encoding||await textFileEncoding(file);
  const size=Math.max(1024,Math.min(8*1024*1024,chunkBytes));
  let start=Math.max(0,Math.floor(startByte));
  while(start<file.size) {
    if(signal?.aborted) throw fail('import_cancelled','读取已停止，可以继续导入。');
    const raw=new Uint8Array(await file.slice(start,Math.min(start+size,file.size)).arrayBuffer());
    if(signal?.aborted) throw fail('import_cancelled','读取已停止，可以继续导入。');
    let length=raw.length;
    if(start+length<file.size) {
      const two=codec.startsWith('utf-16');
      if(two) length-=length%2;
      // Prefer a complete line when it does not leave most of the batch unused.
      for(let i=length-(two?2:1);i>length/2;i-=two?2:1) {
        if((two&&((codec==='utf-16le'&&raw[i]===10&&raw[i+1]===0)||(codec==='utf-16be'&&raw[i]===0&&raw[i+1]===10)))||(!two&&raw[i]===10)) {length=i+(two?2:1);break;}
      }
    }
    let text;
    for(let tail=0;tail<=4;tail++) {
      try {text=new TextDecoder(codec,{fatal:true}).decode(raw.subarray(0,length));break;} catch {
        if(start+raw.length===file.size||tail===4) throw fail('import_invalid_encoding',`文件在约 ${start+length} 字节处有无效编码，请另存为 UTF-8。`);
        length-=codec.startsWith('utf-16')?2:1;
      }
    }
    const end=start+length;
    if(!start) text=text.replace(/^\uFEFF/,'');
    yield {text,startByte:start,endByte:end,encoding:codec,totalBytes:file.size,
      ...(includeLineOffsets?{lineStarts:encodedLineStarts(raw.subarray(0,length),codec,start)}:{})};
    start=end;onProgress?.({readBytes:start,totalBytes:file.size});
  }
}

export async function sampleLargeTextFile(file,{maximumCharacters=60000,signal,onProgress}={}) {
  validateLargeTextFile(file);
  const slots=12, perSlot=Math.floor(maximumCharacters/slots);
  const samples=new Map();let characters=0,batches=0;
  for await(const batch of readTextFileBatches(file,{signal,onProgress})) {
    const slot=Math.min(slots-1,Math.floor(batch.startByte/file.size*slots));
    if(!samples.has(slot)) samples.set(slot,batch.text.slice(0,perSlot));
    characters+=batch.text.length;batches++;
  }
  const text=[...samples.values()].join('\n\n').slice(0,maximumCharacters);
  return {filename:file.name,format:String(file.name).split('.').pop(),text,size:file.size,characters,
    included_characters:text.length,truncated:characters>text.length,sampled:true,batches};
}
