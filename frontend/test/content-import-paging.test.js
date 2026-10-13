import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { previewContentImport, previewContentImportPage, validateImportFile } from '../src/content-import-api.js';

test('paged previews cover a large text without committing, dropping or repeating byte ranges', async()=>{
  const text='星灯：我喜欢看星星。\n'.repeat(5000);
  const file=new File([text],'fixture.txt');
  let startByte=0,joined='',requests=0;
  const client={apiFetch:async(path,options)=>{
    assert.equal(path,'/api/v2/imports/preview'); assert.equal(options.retry,false);
    joined+=await options.body.get('file').text(); requests++;
    return {ok:true,json:async()=>({ok:true,result:{id:'preview-'+requests,candidates:[]}})};
  }};
  while(startByte<file.size) {
    const {page}=await previewContentImportPage({file,kind:'world_book',startByte},client);
    assert.equal(page.startByte,startByte); assert.ok(page.endByte>startByte); startByte=page.endByte;
  }
  assert.equal(joined,text); assert.ok(requests>1);
  validateImportFile({name:'large.md',size:1024**3});
  assert.throws(()=>validateImportFile({name:'large.md',size:1024**3+1}),{code:'import_paged_file_too_large'});
});
test('CSV quoted multiline record is not split across previews',async()=>{
  const csv='role,text\nassistant,"'+('星灯\n'.repeat(23000))+'"\nuser,你好\n';
  const file=new File([csv],'fixture.csv'); let submitted='';
  const client={apiFetch:async(_path,options)=>{submitted=await options.body.get('file').text();return {ok:true,json:async()=>({ok:true})};}};
  const {page}=await previewContentImportPage({file,kind:'chat_history'},client);
  assert.equal(page.endByte,file.size); assert.equal(submitted,csv);
});

test('TSV quoted multiline record is not split across previews',async()=>{
  const tsv='role\ttext\nassistant\t"'+('星灯\n'.repeat(23000))+'"\nuser\t你好\n';
  const file=new File([tsv],'fixture.tsv');let submitted='';
  const client={apiFetch:async(_path,options)=>{submitted=await options.body.get('file').text();return {ok:true,json:async()=>({ok:true})};}};
  const {page}=await previewContentImportPage({file,kind:'chat_history'},client);
  assert.equal(page.endByte,file.size);assert.equal(submitted,tsv);
});

test('only an exact no-candidates 422 exposes a safe page range; nonpaged failures do not',async()=>{
  const file=new File(['user: Ordinary greeting.\n'.repeat(5000)],'synthetic.txt');
  for(const [code,status] of [['import_no_candidates',422],['import_no_candidates',500],['import_json_invalid',422],['request_timeout',504]]) {
    const client={apiFetch:async()=>new Response(JSON.stringify({code}),{status})};
    await assert.rejects(previewContentImportPage({file,kind:'chat_history'},client),error=>{
      assert.equal(error.code,code);assert.equal(error.status,status);
      if(code==='import_no_candidates'&&status===422) {
        assert.equal(error.page.startByte,0);assert.ok(error.page.endByte>0&&error.page.endByte<file.size);assert.equal(error.page.totalBytes,file.size);
      } else assert.equal(error.page,undefined);
      return true;
    });
  }
  await assert.rejects(previewContentImport({file:new File(['user: Hello'],'small.txt'),kind:'chat_history'},
    {apiFetch:async()=>new Response(JSON.stringify({code:'import_no_candidates'}),{status:422})}),error=>{
      assert.equal(error.code,'import_no_candidates');assert.equal(error.page,undefined);return true;
    });
});

test('speaker messages stay complete across text previews and resume in original encoded bytes',async()=>{
  const source='user: My preference is fictional starlight.\r\n'+'灯塔 continuation.\r\n'.repeat(6000)
    +'SYNTHETIC-END\r\nassistant: A synthetic reply.\r\nuser: My preference is a fictional moon.\r\n';
  const utf16=Buffer.from(source,'utf16le');
  const be=Buffer.from(utf16);for(let i=0;i<be.length;i+=2)[be[i],be[i+1]]=[be[i+1],be[i]];
  const gb=Buffer.concat(source.split('灯塔').flatMap((part,index)=>index?[Buffer.from([0xb5,0xc6,0xcb,0xfe]),Buffer.from(part)]:[Buffer.from(part)]));
  for(const [encoding,bytes] of [['utf-8',Buffer.from(source)],['utf-16le',Buffer.concat([Buffer.from([255,254]),utf16])],['utf-16be',Buffer.concat([Buffer.from([254,255]),be])],['gb18030',gb]]) {
    const file=new File([bytes],'synthetic.txt');let submitted='';
    const client={apiFetch:async(_url,options)=>{submitted=await options.body.get('file').text();return new Response(JSON.stringify({ok:true}));}};
    const first=await previewContentImportPage({file,kind:'chat_history'},client);
    assert.ok(submitted.includes('SYNTHETIC-END'),encoding+' must retain the first message tail');
    assert.equal(submitted.includes('assistant:'),false);
    assert.equal(submitted,source.slice(0,source.indexOf('assistant:')));
    assert.equal(new TextDecoder(encoding).decode(bytes.subarray(first.page.endByte)),source.slice(source.indexOf('assistant:')));
    const second=await previewContentImportPage({file,kind:'chat_history',startByte:first.page.endByte},client);
    assert.equal(submitted,source.slice(source.indexOf('assistant:')));
    assert.equal(second.page.endByte,file.size);
  }
});

test('oversized speaker message fails without uploading or advancing, and cancelled accumulation sends nothing',async()=>{
  let calls=0;const client={apiFetch:async()=>{calls++;return new Response('{}');}};
  const oversized=new File(['user: My preference is '+ 'x'.repeat(1024*1024)+'\nassistant: done\n'],'synthetic.txt');
  await assert.rejects(previewContentImportPage({file:oversized,kind:'chat_history'},client),error=>error.code==='import_chat_message_too_large'&&error.page===undefined);
  assert.equal(calls,0);
  const controller=new AbortController();const source=new File(['user: My preference is '+ 'x'.repeat(130000)+'\nassistant: done\n'],'synthetic.txt');
  let reads=0;const file={name:source.name,size:source.size,slice(start,end){const blob=source.slice(start,end);return {async arrayBuffer(){const bytes=await blob.arrayBuffer();if(++reads===3)controller.abort();return bytes;}};}};
  await assert.rejects(previewContentImportPage({file,kind:'chat_history',signal:controller.signal},client),error=>error.code==='import_cancelled'||error.name==='AbortError');
  assert.equal(calls,0);
});

test('legacy cursor inside a speaker continuation is rejected, while CR speakers and unlabelled resumes remain supported',async()=>{
  const source='user: My preference is fictional starlight.\r'+'Fictional continuation.\r'.repeat(4000)+'assistant: reply.\ruser: My preference is a moon.\r';
  const file=new File([source],'synthetic.log');let calls=0,submitted='';
  const client={apiFetch:async(_url,options)=>{calls++;submitted=await options.body.get('file').text();return new Response('{}');}};
  await assert.rejects(previewContentImportPage({file,kind:'chat_history',startByte:source.indexOf('Fictional continuation.')},client),error=>error.code==='import_chat_boundary_invalid'&&error.page===undefined);
  assert.equal(calls,0);
  const first=await previewContentImportPage({file,kind:'chat_history'},client);
  assert.equal(submitted,source.slice(0,source.indexOf('assistant:')));
  const second=await previewContentImportPage({file,kind:'chat_history',startByte:first.page.endByte},client);
  assert.equal(submitted,source.slice(source.indexOf('assistant:')));assert.equal(second.page.endByte,file.size);
  const plain=new File(['Fictional unlabelled paragraph.\n'.repeat(5000)],'unlabelled.txt');
  const resumed=await previewContentImportPage({file:plain,kind:'chat_history',startByte:310},client);
  assert.equal(resumed.page.startByte,310);assert.equal(submitted,(await plain.text()).slice(310,resumed.page.endByte));
});

test('a later speaker page uses complete messages even when the original head has no labels',async()=>{
  const preface='Fictional narrative line.\n'.repeat(4000);
  const message='user: My preference is a fictional moon.\n'+'Fictional continuation.\n'.repeat(4000)+'SYNTHETIC-END\n';
  const file=new File([preface,message,'assistant: reply.\n'],'synthetic.txt');let submitted='';
  const client={apiFetch:async(_url,options)=>{submitted=await options.body.get('file').text();return new Response('{}');}};
  const page=await previewContentImportPage({file,kind:'chat_history',startByte:preface.length},client);
  assert.equal(submitted,message);assert.equal(page.page.endByte,preface.length+message.length);
});

test('one chat message over the existing saved-candidate capacity is rejected before uploading',async()=>{
  let calls=0;const client={apiFetch:async()=>{calls++;return new Response('{}');}};
  const body='My preference is '+ 'x'.repeat(250001-'My preference is '.length);
  const file=new File(['user: '+body+'\nassistant: reply\n'],'synthetic.txt');
  await assert.rejects(previewContentImportPage({file,kind:'chat_history'},client),error=>error.code==='import_chat_message_too_large'&&error.page===undefined);
  assert.equal(calls,0);
});

test('speaker labels keep the backend inline-whitespace and timestamp semantics',async()=>{
  const first='[2026-10-10 09:00]　用户　说　：我喜欢虚构星河。\n'+'Fictional continuation.\n'.repeat(4000)+'SYNTHETIC-END\n';
  const last='2026-10-10T09:00:00Z |　助手　| synthetic reply.\n';
  const file=new File([first,last],'synthetic.md');let submitted='';
  const client={apiFetch:async(_url,options)=>{submitted=await options.body.get('file').text();return new Response('{}');}};
  const page=await previewContentImportPage({file,kind:'chat_history'},client);
  assert.equal(submitted,first);assert.equal(page.page.endByte,Buffer.byteLength(first));
  const resumed=await previewContentImportPage({file,kind:'chat_history',startByte:page.page.endByte},client);
  assert.equal(submitted,last);assert.equal(resumed.page.endByte,file.size);
});

test('saved message capacity accepts its exact edge, and Unicode separators do not invent new speakers',async()=>{
  let calls=0,submitted='';const client={apiFetch:async(_url,options)=>{calls++;submitted=await options.body.get('file').text();return new Response('{}');}};
  const body='My preference is '+'x'.repeat(200000-'My preference is '.length);
  await previewContentImportPage({file:new File(['user: '+body],'synthetic.txt'),kind:'chat_history'},client);
  assert.equal(submitted,'user: '+body);assert.equal(calls,1);
  for(const value of [body+'x','My preference is '+ 'x'.repeat(125000)+'\u2028user: '+ 'x'.repeat(125000)]) {
    await assert.rejects(previewContentImportPage({file:new File(['user: '+value],'synthetic.txt'),kind:'chat_history'},client),{code:'import_chat_message_too_large'});
  }
  assert.equal(calls,1);
});
