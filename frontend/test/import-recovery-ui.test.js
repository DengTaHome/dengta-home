import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {createServer} from 'vite';
import {fingerprintImportFile} from '../src/import-file-fingerprint.js';
import {importCheckpointKey,saveImportCheckpoint,readImportCheckpoint} from '../src/import-checkpoint.js';
import {importCommitRecovery} from '../src/content-import-api.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
const button=(renderer,label)=>renderer.root.find(n=>n.type==='button'&&text(n)===label);
const preview={import:{id:'receipt-1',status:'preview'},candidates:[{id:'candidate-1',candidate_type:'memory',title:'Synthetic',content:'Synthetic content'}]};

test('pending receipt GET preserves every existing edit and decision while unknown commits stay locked',async()=>{
  const previousStorage=globalThis.localStorage,previousWindow=globalThis.window;
  const values=new Map();globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={dispatchEvent:()=>{}};
  const source={import:{id:'edited-pending',status:'preview',commit_protocol:'atomic-v1'},candidates:[
    {id:'edited-world',candidate_type:'world_book',title:'Synthetic world',content:'Synthetic original world',target:'world_book_entries',metadata:{keywords:['source'],priority:100,sort_order:0}},
    {id:'rejected-memory',candidate_type:'memory',title:'Synthetic memory',content:'Synthetic original memory',target:'memories'},
  ]};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  const control=label=>renderer.root.find(n=>n.props['aria-label']===label&&(n.type==='input'||n.type==='textarea'||n.type==='select'));
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    for(const mode of ['paste','small-file','paged-file']) {
      let posts=0,gets=0,submitted;
      const api={apiFetch:async()=>new Response(JSON.stringify({result:source}),{status:201}),apiRequest:async(path,options)=>{
        if(path==='/api/v2/imports/')return{imports:[]};
        if(path.endsWith('/preview'))return{result:source};
        if(path.endsWith('/commit')){posts++;submitted=JSON.parse(options.body).decisions;throw Object.assign(Error('Synthetic lost response'),{code:'request_timeout'});}
        assert.equal(path,'/api/v2/imports/edited-pending');gets++;return{result:source};
      }};
      await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'pending-draft-'+mode,companionScope:'c'}));});
      if(mode==='paste') {
        await act(async()=>control('输入方式').props.onChange({target:{value:'paste'}}));
        await act(async()=>control('粘贴导入内容').props.onChange({target:{value:'Synthetic source'}}));
      } else {
        const file=new File([mode==='paged-file'?'Synthetic\n'.repeat(120000):'Synthetic source'],'synthetic.txt');
        await act(async()=>control('选择导入文件').props.onChange({target:{files:[file]}}));
      }
      await act(async()=>button(renderer,'生成导入预览').props.onClick());
      for(let i=0;i<100&&!text(renderer.toJSON()).includes('全选接受');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
      await act(async()=>control('Synthetic world的内容').props.onChange({target:{value:'Synthetic edited full draft'}}));
      await act(async()=>control('Synthetic world的标题').props.onChange({target:{value:'Edited world'}}));
      for(const [field,value] of [['关键词','keep, edited'],['优先级','321'],['排序值','24'],['匹配方式','all'],['上下文位置','before_memory']]) {
        await act(async()=>control('Edited world的'+field).props.onChange({target:{value}}));
      }
      const switches=renderer.root.findAll(n=>n.type==='input'&&n.props.type==='checkbox');
      for(const [index,checked] of [[0,false],[1,true],[2,true]])await act(async()=>switches[index].props.onChange({target:{checked}}));
      await act(async()=>button(renderer,'全选拒绝').props.onClick());
      const world=()=>renderer.root.find(n=>n.type==='article'&&n.findAll(child=>child.type==='input'&&child.props['aria-label']==='Edited world的标题').length);
      await act(async()=>world().find(n=>n.type==='button'&&text(n)==='接受').props.onClick());
      await act(async()=>button(renderer,'确认并提交').props.onClick());
      assert.equal(posts,1);assert.match(text(renderer.toJSON()),/request_timeout/);
      assert.deepEqual(submitted.map(row=>row.decision),['accepted','rejected']);
      assert.deepEqual(submitted[0],{id:'edited-world',candidate_id:'edited-world',decision:'accepted',accepted:true,title:'Edited world',content:'Synthetic edited full draft',target:'world_book_entries',keywords:['keep','edited'],enabled:false,priority:321,constant:true,match_mode:'all',case_sensitive:true,position:'before_memory',sort_order:24});
      const snapshot=()=>({title:control('Edited world的标题').props.value,content:control('Edited world的内容').props.value,keywords:control('Edited world的关键词').props.value,priority:control('Edited world的优先级').props.value,sortOrder:control('Edited world的排序值').props.value,matchMode:control('Edited world的匹配方式').props.value,position:control('Edited world的上下文位置').props.value,switches:renderer.root.findAll(n=>n.type==='input'&&n.props.type==='checkbox').map(n=>n.props.checked),decisions:renderer.root.findAll(n=>n.type==='article'&&n.props.className?.includes('content-import-candidate')).map(n=>n.props.className)});
      const beforeGet=snapshot();
      await act(async()=>button(renderer,'检查提交结果').props.onClick());
      assert.match(text(renderer.toJSON()),/import_commit_pending/);
      assert.deepEqual(snapshot(),beforeGet);
      assert.equal(button(renderer,'确认并提交').props.disabled,true);
      assert.equal(button(renderer,'全选接受').props.disabled,true);
      await act(async()=>button(renderer,'确认并提交').props.onClick());assert.equal(posts,1);
      await act(async()=>button(renderer,'检查提交结果').props.onClick());assert.deepEqual(snapshot(),beforeGet);assert.equal(gets,2);assert.equal(posts,1);
      await act(async()=>renderer.unmount());renderer=null;
    }
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;globalThis.window=previousWindow;}
});
test('empty pages require explicit progress confirmation and expose later candidates without committing',async()=>{
  const previousStorage=globalThis.localStorage,values=new Map();
  globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const file=new File(['user: Ordinary synthetic greeting.\n'.repeat(4500),'user: My preference is synthetic starlight.\n','user: Ordinary greeting.\n'.repeat(40000)],'synthetic-chat.txt');
  assert.ok(file.size>1024*1024);
  const requests=[];
  const api={apiRequest:async path=>{assert.equal(path,'/api/v2/imports/');return{imports:[]};},apiFetch:async(path,options)=>{
    assert.equal(path,'/api/v2/imports/preview');
    const part=options.body.get('file');requests.push(part.name);
    if((await part.text()).includes('My preference is synthetic starlight')) {
      return new Response(JSON.stringify({result:{import:{id:'synthetic-flow',status:'preview'},candidates:[{id:'synthetic-preference',candidate_type:'memory',title:'Synthetic preference',content:'My preference is synthetic starlight.',target:'user_details'}]}}),{status:201});
    }
    return new Response(JSON.stringify({code:'import_no_candidates'}),{status:422});
  }};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  const waitFor=async predicate=>{for(let i=0;i<100&&!predicate();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});assert.ok(predicate());};
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'empty-pages-account',companionScope:'c'}));});
    await act(async()=>button(renderer,'聊天记录').props.onClick());
    await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await waitFor(()=>text(renderer.toJSON()).includes('import_no_candidates'));
    const checkpointKey=[...values.keys()].find(key=>key.startsWith('dengta_import_checkpoint_v1.'));
    assert.ok(checkpointKey);assert.equal(JSON.parse(values.get(checkpointKey)).nextByte,0);assert.equal(requests.length,1);
    const range=name=>{const match=/^part-(\d+)-(\d+)\.txt$/.exec(name);assert.ok(match);return{start:Number(match[1]),end:Number(match[2])};};
    const firstRange=range(requests[0]);assert.equal(firstRange.start,0);assert.ok(firstRange.end>0&&firstRange.end<file.size);
    assert.equal(renderer.root.findAll(n=>n.type==='button'&&text(n)==='确认并提交').length,0);
    await act(async()=>button(renderer,'确认本段无候选，继续下一段').props.onClick());
    await waitFor(()=>requests.length===2&&text(renderer.toJSON()).includes('import_no_candidates'));
    assert.equal(JSON.parse(values.get(checkpointKey)).nextByte,firstRange.end);
    const secondRange=range(requests[1]);assert.equal(secondRange.start,firstRange.end);
    await act(async()=>button(renderer,'确认本段无候选，继续下一段').props.onClick());
    await waitFor(()=>text(renderer.toJSON()).includes('全选接受'));
    assert.equal(requests.length,3);const thirdRange=range(requests[2]);assert.equal(thirdRange.start,secondRange.end);
    assert.match(renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='Synthetic preference的内容').props.value,/My preference is synthetic starlight/);
    assert.equal(JSON.parse(values.get(checkpointKey)).nextByte,thirdRange.start);assert.equal(JSON.parse(values.get(checkpointKey)).pending.commitAttempted,false);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;}
});

test('last empty page advances only after confirmation; an oversized edit keeps the complete draft',async()=>{
  const previousStorage=globalThis.localStorage,values=new Map();
  globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const file=new File(['Synthetic\n'.repeat(120000)],'synthetic.txt');
  const key=importCheckpointKey('empty-final-account','c','world_book',await fingerprintImportFile(file));
  saveImportCheckpoint(key,{version:1,totalBytes:file.size,nextByte:file.size-10,pending:null});
  let posts=0;
  const parsed={warnings:[{message:'源条目 250,020 字符，保留 200,000，另有 50,020 未纳入。'}],candidates:[{
    title:'Synthetic world',candidate_type:'world_book',target:'world_book_entries',content:'S'.repeat(200000),
    metadata:{content_truncation:{truncated:true,source_characters:250020,retained_characters:200000,omitted_characters:50020}}
  }]};
  const api={apiFetch:async()=>new Response(JSON.stringify({code:'import_no_candidates'}),{status:422}),apiRequest:async(path,options)=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:{import:{id:'synthetic-long',status:'preview'},warnings:parsed.warnings,candidates:parsed.candidates.map(candidate=>({...candidate,id:'synthetic-long-candidate'}))}};
    if(path.endsWith('/commit')){posts++;assert.equal(JSON.parse(options.body).decisions[0].content.length,200001);throw Object.assign(Error('Synthetic'),{code:'import_content_invalid',status:400});}
    throw Error('Unexpected synthetic request');
  }};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'empty-final-account',companionScope:'c'}));});
    await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    for(let i=0;i<100&&!text(renderer.toJSON()).includes('import_no_candidates');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    assert.equal(readImportCheckpoint(key,file.size).nextByte,file.size-10);
    await act(async()=>button(renderer,'确认末段无候选，结束读取').props.onClick());
    assert.equal(readImportCheckpoint(key,file.size).nextByte,file.size);assert.match(text(renderer.toJSON()),/本段没有写入任何内容/);assert.equal(posts,0);
    await act(async()=>renderer.unmount());renderer=null;
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'long-draft-account',companionScope:'c'}));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    assert.match(text(renderer.toJSON()),/此候选仅含部分正文/);assert.match(text(renderer.toJSON()),/50,020/);
    const edited='E'.repeat(200001);
    await act(async()=>renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='Synthetic world的内容').props.onChange({target:{value:edited}}));
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    assert.equal(posts,1);assert.match(text(renderer.toJSON()),/import_content_invalid/);
    assert.equal(renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='Synthetic world的内容').props.value,edited);
    assert.equal(button(renderer,'确认并提交').props.disabled,false);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;}
});

test('paged resolution resumes discarded bytes, advances completed bytes and preserves an unknown pending segment',async()=>{
  const previousStorage=globalThis.localStorage,previousWindow=globalThis.window;
  const values=new Map(),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.localStorage=store;globalThis.window={dispatchEvent:()=>{}};
  const file=new File(['Synthetic\n'.repeat(120000)],'synthetic.txt'),fingerprint=await fingerprintImportFile(file);
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    for(const outcome of ['discarded','committed','network']) {
      const account='paged-resolve-'+outcome,key=importCheckpointKey(account,'c','world_book',fingerprint);
      saveImportCheckpoint(key,{version:1,totalBytes:file.size,nextByte:100,pending:{importId:'receipt-1',startByte:100,endByte:500,commitAttempted:true}},store);
      let resolves=0,previews=0;
      const api={apiRequest:async path=>{
        if(path==='/api/v2/imports/')return{imports:[]};
        if(path.endsWith('/receipt-1'))return{result:{...preview,import:{...preview.import,commit_protocol:'atomic-v1'}}};
        if(path.endsWith('/resolve')) {
          resolves++;if(outcome==='network')throw Object.assign(Error('private'),{code:'import_commit_unconfirmed'});
          const accepted=outcome==='committed'?1:0;
          return{result:{import:{id:'receipt-1',status:'committed',candidate_count:1,accepted_count:accepted,rejected_count:1-accepted},accepted_count:accepted,rejected_count:1-accepted,resolution:outcome,resolution_protocol:'reject-pending-v1'}};
        }
        throw Error('unexpected request');
      },apiFetch:async(_path,options)=>{
        previews++;assert.ok((await options.body.get('file').text()).startsWith('Synthetic\n'));
        return new Response(JSON.stringify({result:{...preview,import:{id:'next-preview',status:'preview'}}}),{headers:{'Content-Type':'application/json'}});
      }};
      await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:account,companionScope:'c'}));});
      await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}}));
      await act(async()=>button(renderer,'生成导入预览').props.onClick());
      for(let i=0;i<60&&!text(renderer.toJSON()).includes('这一段曾尝试提交');i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
      await act(async()=>button(renderer,'检查提交结果').props.onClick());
      await act(async()=>button(renderer,'放弃旧候选并核对结果').props.onClick());
      assert.equal(resolves,1);assert.equal(previews,0);
      const saved=readImportCheckpoint(key,file.size,store);
      assert.equal(saved.nextByte,outcome==='committed'?500:100);
      assert.equal(Boolean(saved.pending),outcome==='network');
      if(outcome==='discarded') {
        assert.equal(text(renderer.toJSON()).includes('读取下一段'),false,'discarded segment must not offer skipping it');
        await act(async()=>button(renderer,'生成导入预览').props.onClick());
        for(let i=0;i<60&&!previews;i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
        assert.equal(previews,1);assert.equal(readImportCheckpoint(key,file.size,store).pending.startByte,100);
      }
      await act(async()=>renderer.unmount());renderer=null;
    }
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;globalThis.window=previousWindow;}
});

test('explicit pending resolution unlocks only matching results and preserves unknown failures',async()=>{
  const previousStorage=globalThis.localStorage,previousWindow=globalThis.window;
  const values=new Map();globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  let events=0;globalThis.window={dispatchEvent:()=>events++};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    const receipts=await vite.ssrLoadModule('/src/import-attempt-receipt.js');
    for(const outcome of ['discarded','committed','invalid','network']) {
      let resolves=0,posts=0;const account='resolve-'+outcome,prefix=receipts.importAttemptPrefix(account,'companion');
      receipts.saveImportAttempt(prefix,{version:1,importId:'receipt-1',kind:'world_book',startedAt:123});
      const api={apiRequest:async(path,options)=>{
        if(path==='/api/v2/imports/')return{imports:[]};
        if(path.endsWith('/receipt-1'))return{result:{...preview,import:{...preview.import,commit_protocol:'atomic-v1'}}};
        if(path.endsWith('/resolve')) {
          resolves++;assert.deepEqual(JSON.parse(options.body),{confirm_reject_pending:true});
          if(outcome==='network')throw Object.assign(Error('private'),{code:'import_commit_unconfirmed',status:503});
          const accepted=outcome==='committed'?1:0;
          return{result:{import:{id:'receipt-1',status:'committed',accepted_count:accepted,rejected_count:1-accepted,candidate_count:1},accepted_count:accepted,rejected_count:1-accepted,resolution:outcome==='invalid'?'committed':outcome,resolution_protocol:'reject-pending-v1'}};
        }
        posts++;throw Error('unexpected POST');
      }};
      await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:account,companionScope:'companion'}));});
      await act(async()=>button(renderer,'核对这次导入').props.onClick());
      assert.equal(resolves,0,'receipt checks alone cannot reject candidates');
      assert.match(text(renderer.toJSON()),/尚未提交的全部旧候选/);
      await act(async()=>button(renderer,'放弃旧候选并核对结果').props.onClick());
      assert.equal(resolves,1);assert.equal(posts,0);
      if(['invalid','network'].includes(outcome)) {
        assert.equal(receipts.readImportAttempts(prefix).length,1);
        assert.equal(button(renderer,'生成导入预览').props.disabled,true);
        assert.match(text(renderer.toJSON()),/旧提交编号仍保留/);
        assert.equal(text(renderer.toJSON()).includes('private'),false);
      } else {
        assert.equal(receipts.readImportAttempts(prefix).length,0);
        assert.equal(renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.disabled,false);
        assert.match(text(renderer.toJSON()),outcome==='discarded'?/没有写入用户内容/:/原提交已经完成/);
      }
      await act(async()=>renderer.unmount());renderer=null;receipts.clearImportAttempt(prefix,'receipt-1');
    }
    assert.equal(events,1,'only an existing completed accepted import refreshes memory');
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;globalThis.window=previousWindow;}
});

test('paste and small-file unknown commits survive closing; receipt GET never resubmits and pending stays locked',async()=>{
  const previousStorage=globalThis.localStorage,previousWindow=globalThis.window;
  globalThis.window={dispatchEvent:()=>{}};
  const values=new Map();globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer,posts=0,gets=0,serverStatus='preview';
  const api={apiFetch:async()=>new Response(JSON.stringify({result:preview}),{headers:{'Content-Type':'application/json'}}),apiRequest:async path=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:preview};
    if(path.endsWith('/commit')){posts++;assert.equal(values.size,1,'receipt must exist before POST');throw Object.assign(Error('private'),{code:'request_timeout'});}
    if(path.endsWith('/receipt-1')){gets++;return{result:{import:{id:'receipt-1',status:serverStatus,commit_protocol:'atomic-v1',accepted_count:1},candidates:preview.candidates}};}
    throw Error('unexpected request');
  }};
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    for(const mode of ['paste','file']) {
      serverStatus='preview';const props={api,accountScope:'durable-'+mode,companionScope:'companion'};
      await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,props));});
      if(mode==='paste') {
        await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
        await act(async()=>renderer.root.find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic'}}));
      } else await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[new File(['Synthetic'],'small.txt')]}}));
      await act(async()=>button(renderer,'生成导入预览').props.onClick());
      for(let i=0;i<50&&!text(renderer.toJSON()).includes('全选接受');i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
      await act(async()=>button(renderer,'全选接受').props.onClick());
      await act(async()=>button(renderer,'确认并提交').props.onClick());
      const expectedPosts=posts;
      await act(async()=>renderer.unmount());renderer=null;
      await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{...props,accountScope:'different-account'}));});
      assert.equal(text(renderer.toJSON()).includes('有 1 次导入结果待核对'),false);
      await act(async()=>renderer.unmount());renderer=null;
      await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,props));});
      assert.match(text(renderer.toJSON()),/receipt-1/);assert.equal(posts,expectedPosts);
      assert.equal(gets,(mode==='paste'?0:2),'opening alone must not call receipt GET');
      await act(async()=>button(renderer,'核对这次导入').props.onClick());
      assert.match(text(renderer.toJSON()),/import_commit_pending/);
      assert.equal(button(renderer,'生成导入预览').props.disabled,true);
      assert.equal(posts,expectedPosts);
      serverStatus='committed';await act(async()=>button(renderer,'核对这次导入').props.onClick());
      assert.match(text(renderer.toJSON()),/导入完成/);assert.equal(values.size,0);assert.equal(posts,expectedPosts);
      await act(async()=>renderer.unmount());renderer=null;
    }
    assert.equal(posts,2);assert.equal(gets,4);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;globalThis.window=previousWindow;}
});

test('verified rollback permits an edited retry; legacy previews require review and unknown errors stay locked',async()=>{
  assert.equal(importCommitRecovery('import_commit_rolled_back'),'retry');
  assert.equal(importCommitRecovery('import_transaction_unavailable'),'retry');
  assert.equal(importCommitRecovery('import_commit_unconfirmed'),'check');
  assert.equal(importCommitRecovery('import_commit_receipt_invalid'),'check');
  assert.equal(importCommitRecovery('request_timeout'),'check');
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
  let posts=0,previews=0,renderer;
  const api={apiRequest:async(path)=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview')){previews++;return{result:preview};}
    if(path.endsWith('/commit')){posts++;throw Object.assign(Error('private content'),{code:posts===1?'import_commit_rolled_back':'import_legacy_preview',status:503});}
    throw Error('unexpected endpoint');
  }};
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api}));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='粘贴导入内容').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    assert.match(text(renderer.toJSON()),/已全部回滚/);
    assert.equal(button(renderer,'确认并提交').props.disabled,false);
    assert.equal(button(renderer,'全选接受').props.disabled,false);
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    assert.equal(posts,2);assert.equal(previews,1);
    assert.equal(button(renderer,'确认并提交').props.disabled,true);
    assert.equal(text(renderer.toJSON()).includes('private content'),false);
    await act(async()=>button(renderer,'已核对旧结果，重新预览本段').props.onClick());
    assert.equal(previews,1,'review must not silently create or write another import');
    assert.equal(button(renderer,'生成导入预览').props.disabled,false);
    assert.match(text(renderer.toJSON()),/不会删除/);
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    assert.equal(previews,2);assert.equal(posts,2);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();}
});

test('lost commit receipt prevents another POST, then GET confirmation unlocks the page',async()=>{
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
  const previousWindow=globalThis.window;let events=0,posts=0;
  globalThis.window={dispatchEvent:()=>events++};
  const api={apiRequest:async(path)=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:preview};
    if(path.endsWith('/commit')){posts++;throw Object.assign(new Error('private upstream text'),{code:'request_timeout',status:504});}
    if(path.endsWith('/receipt-1'))return{result:{import:{id:'receipt-1',status:'committed',accepted_count:1}}};
    throw Error('unexpected endpoint');
  }};
  let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api}));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='粘贴导入内容').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    assert.equal(posts,1);assert.equal(events,0);
    assert.equal(button(renderer,'确认并提交').props.disabled,true);
    assert.equal(button(renderer,'全选接受').props.disabled,true);
    assert.equal(button(renderer,'生成导入预览').props.disabled,true);
    assert.equal(text(renderer.toJSON()).includes('private upstream text'),false);
    await act(async()=>button(renderer,'查看日志').props.onClick());
    assert.match(text(renderer.toJSON()),/提交回执未确认时，先检查提交结果/);
    await act(async()=>button(renderer,'确认并提交').props.onClick());assert.equal(posts,1);
    await act(async()=>button(renderer,'检查提交结果').props.onClick());
    assert.match(text(renderer.toJSON()),/导入完成/);assert.equal(posts,1);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.window=previousWindow;}
});
test('same source restores a pending page and confirms a previously committed page without creating another preview',async()=>{
  const values=new Map(),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const previousStorage=globalThis.localStorage;globalThis.localStorage=store;
  const file=new File(['Synthetic\n'.repeat(120000)],'synthetic.txt');
  const key=importCheckpointKey('a','c','world_book',await fingerprintImportFile(file));
  saveImportCheckpoint(key,{version:1,totalBytes:file.size,nextByte:100,pending:{importId:'receipt-1',startByte:100,endByte:500,commitAttempted:true}},store);
  let previews=0;
  const api={apiRequest:async path=>{if(path==='/api/v2/imports/')return{imports:[]};if(path.endsWith('/receipt-1'))return{result:{import:{id:'receipt-1',status:'committed',accepted_count:1}}};previews++;throw Error('unexpected write');}};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'a',companionScope:'c'}));});
    await act(async()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[file]}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    // The click handler intentionally returns immediately; wait for background hashing and receipt lookup.
    for(let i=0;i<30&&!text(renderer.toJSON()).includes('无需重复写入');i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
    assert.match(text(renderer.toJSON()),/无需重复写入/);assert.equal(previews,0);
    assert.equal(readImportCheckpoint(key,file.size,store).nextByte,500);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;}
});

test('unmount cancels an outstanding commit and prevents an old companion refresh event',async()=>{
  const previousWindow=globalThis.window;let events=0,resolveCommit,signal;
  const previousStorage=globalThis.localStorage,values=new Map();
  globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={dispatchEvent:()=>events++};
  const api={apiRequest:async(path,options)=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:preview};
    signal=options.signal;return new Promise(resolve=>{resolveCommit=resolve;});
  }};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer;
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{api,accountScope:'closing-commit',companionScope:'companion'}));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea'&&n.props['aria-label']==='粘贴导入内容').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    assert.equal(values.size,1);
    await act(async()=>renderer.unmount());renderer=null;assert.equal(signal.aborted,true);
    await act(async()=>resolveCommit({result:{import:{id:'receipt-1',status:'committed'}}}));
    assert.equal(events,0);
    assert.equal(values.size,1,'late completion must not erase the receipt after unmount');
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.window=previousWindow;globalThis.localStorage=previousStorage;}
});

test('a missing receipt requires explicit review and does not resubmit or delete imported content',async()=>{
  const previousStorage=globalThis.localStorage;
  const values=new Map();globalThis.localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});let renderer,posts=0,gets=0;
  const api={apiRequest:async path=>{
    if(path==='/api/v2/imports/')return{imports:[]};
    if(path.endsWith('/preview'))return{result:preview};
    if(path.endsWith('/commit')){posts++;throw Object.assign(Error(),{code:'request_timeout'});}
    gets++;throw Object.assign(Error(),{code:'import_not_found',status:404});
  }};
  try {
    const {default:Component}=await vite.ssrLoadModule('/src/ContentImport.jsx');
    const props={api,accountScope:'missing-receipt-account',companionScope:'companion'};
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,props));});
    await act(async()=>renderer.root.find(n=>n.type==='select'&&n.props['aria-label']==='输入方式').props.onChange({target:{value:'paste'}}));
    await act(async()=>renderer.root.find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic'}}));
    await act(async()=>button(renderer,'生成导入预览').props.onClick());
    await act(async()=>button(renderer,'全选接受').props.onClick());
    await act(async()=>button(renderer,'确认并提交').props.onClick());
    await act(async()=>renderer.unmount());renderer=null;
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,props));});
    await act(async()=>button(renderer,'核对这次导入').props.onClick());
    assert.match(text(renderer.toJSON()),/import_receipt_missing/);assert.equal(values.size,1);
    assert.equal(button(renderer,'生成导入预览').props.disabled,true);
    await act(async()=>button(renderer,'已核对旧结果，重新预览本段').props.onClick());
    assert.equal(values.size,0);assert.equal(posts,1);assert.equal(gets,1);
    assert.match(text(renderer.toJSON()),/不会删除/);
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.localStorage=previousStorage;}
});
