import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readTextFileBatches, sampleLargeTextFile, textFileEncoding, validateLargeTextFile } from '../src/large-text-file.js';

const file = (bytes, name = 'fixture.txt') => Object.assign(new Blob([bytes]), { name });
test('Chinese and emoji survive boundaries, resume, UTF-16 and GB18030', async () => {
  const text = '星灯🌟：一起看星星\n'.repeat(300);
  const fixture = file(text);
  const batches = [];
  for await (const batch of readTextFileBatches(fixture, { chunkBytes: 1024 })) batches.push(batch);
  assert.equal(batches.map(batch => batch.text).join(''), text);
  let tail = '';
  for await (const batch of readTextFileBatches(fixture, { startByte: batches[0].endByte, chunkBytes: 1024 })) tail += batch.text;
  assert.equal(batches[0].text + tail, text);
  const utf16 = file(Buffer.concat([Buffer.from([255,254]), Buffer.from(text,'utf16le')]));
  let decoded = ''; for await (const batch of readTextFileBatches(utf16,{chunkBytes:1024})) decoded += batch.text;
  assert.equal(decoded,text);
  const gbk = file(Uint8Array.from([0xb5,0xc6,0xcb,0xfe]));
  assert.equal(await textFileEncoding(gbk),'gb18030');
  for await (const batch of readTextFileBatches(gbk)) assert.equal(batch.text,'灯塔');
});
test('cancel, invalid binary and exact 1GB boundary have explicit errors', async () => {
  assert.throws(() => validateLargeTextFile({name:'fixture.txt',size:1024**3+1}),{code:'import_file_too_large'});
  validateLargeTextFile({name:'fixture.txt',size:1024**3});
  await assert.rejects(textFileEncoding(file(Uint8Array.from([0x50,0x4b,3,4]))),{code:'import_binary_disguised'});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(async () => {for await (const batch of readTextFileBatches(file('星灯'),{signal:controller.signal})) assert.fail(batch.text);},{code:'import_cancelled'});
});
test('large samples scan every byte with bounded slices and mark incomplete model coverage', async () => {
  let maxRead = 0, readBytes = 0;
  const bytes = 24 * 1024 * 1024;
  const fixture = {name:'fixture.txt',size:bytes,slice(start,end) {
    maxRead = Math.max(maxRead,end-start);
    readBytes += end-start;
    return new Blob(['x'.repeat(end-start)]);
  }};
  const sampled = await sampleLargeTextFile(fixture);
  assert.equal(sampled.characters,bytes);
  assert.equal(sampled.text.length,60000);
  assert.equal(sampled.sampled,true); assert.equal(sampled.truncated,true);
  assert.ok(maxRead <= 1024*1024);
  assert.equal(readBytes,bytes+65536);
});

test('optional line offsets preserve original encoded byte coordinates including BOM, CRLF and CR',async()=>{
  const text='灯塔 first\r\nsecond\rthird\n'.repeat(200);
  const utf16=Buffer.from(text,'utf16le');const be=Buffer.from(utf16);for(let i=0;i<be.length;i+=2)[be[i],be[i+1]]=[be[i+1],be[i]];
  const gb=Buffer.concat(text.split('灯塔').flatMap((part,index)=>index?[Buffer.from([0xb5,0xc6,0xcb,0xfe]),Buffer.from(part)]:[Buffer.from(part)]));
  for(const [codec,bytes] of [['utf-8',Buffer.from(text)],['utf-16le',Buffer.concat([Buffer.from([255,254]),utf16])],['utf-16be',Buffer.concat([Buffer.from([254,255]),be])],['gb18030',gb]]) {
    for await(const batch of readTextFileBatches(file(bytes),{chunkBytes:1024,includeLineOffsets:true})) {
      assert.equal(batch.lineStarts[0].characterOffset,0);assert.equal(batch.lineStarts[0].byteOffset,batch.startByte);
      for(const line of batch.lineStarts) {
        assert.equal(new TextDecoder(codec).decode(bytes.subarray(batch.startByte,line.byteOffset)),batch.text.slice(0,line.characterOffset));
        if(line.characterOffset)assert.match(batch.text.slice(0,line.characterOffset),/[\r\n]$/);
      }
    }
  }
});
