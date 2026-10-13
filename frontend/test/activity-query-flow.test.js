import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { activityRequestInScope, buildCompanionActivityRequest } from '../src/companion-activities.js';
import { appendActivityDraft } from '../src/chat-activities.js';
import { storeDirectMediaSession } from '../src/direct-media.js';
import { mediaPlaybackFeedback } from '../src/media-playback-errors.js';

const action={id:'fixture-activity',kind:'watch',query:'虚构电影 & ? 中文',pageUrl:'https://www.bilibili.com/video/BV1234567890'};
const request=buildCompanionActivityRequest(action,'account-a','companion-a');
assert.equal(request.query,action.query);assert.equal(request.pageUrl,action.pageUrl);
assert.equal(activityRequestInScope(request,'account-a','companion-a'),request);
assert.equal(activityRequestInScope(request,'account-a','companion-b'),null);
assert.equal(activityRequestInScope(request,'account-b','companion-a'),null);
assert.equal(buildCompanionActivityRequest({...action,pageUrl:'javascript:fixture'},'account-a','companion-a').pageUrl,'');
assert.equal(buildCompanionActivityRequest(action,'','companion-a'),null);
assert.equal(buildCompanionActivityRequest({id:'x',kind:'pay'},'account-a','companion-a'),null);
const descriptors=new Map();
function stub(name,value){descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,value,writable:true});}
const storage=new Map();
stub('window',{setInterval,clearInterval,setTimeout,clearTimeout});stub('document',{hidden:false});
stub('sessionStorage',{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)});
stub('IS_REACT_ACT_ENVIRONMENT',true);stub('__watchFixture',{resolve:async()=>null});
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{
  name:'watch-page-fixture',enforce:'pre',
  transform(code,id){if(id.replaceAll('\\','/').endsWith('/Together.jsx'))return code.replace('"./co-watch"','"virtual:watch-api"').replace('"./api.js"','"virtual:watch-base"').replace('"./BilibiliQrLogin.jsx"','"virtual:watch-placeholder"').replace('"./TogetherMusic.jsx"','"virtual:watch-placeholder"');},
  resolveId(id){if(id.startsWith('virtual:watch-'))return '\0'+id;},
  load(id){
    if(id==='\0virtual:watch-api')return 'export const resolveCoWatchPage=(...args)=>globalThis.__watchFixture.resolve(...args); export const formatMediaTime=()=>"0:00";';
    if(id==='\0virtual:watch-base')return 'export const API_BASE_URL="https://api.example.test";';
    if(id==='\0virtual:watch-placeholder')return 'export default function Placeholder(){return null;}';
  },
}]});
let tree, mediaNode, reloads=0;
async function mount(Component,props){await act(async()=>{tree=TestRenderer.create(React.createElement(Component,props),{createNodeMock: node=>node.type==='video'?(mediaNode={load(){reloads++;},pause(){},currentTime:0,duration:120,paused:true,currentSrc:node.props.src}):null});});}
async function unmount(){if(tree){await act(async()=>tree.unmount());tree=null;}}
try{
  const {WatchQueryPanel,TakeoutQueryPanel}=await vite.ssrLoadModule('/src/ActivityQueryPanels.jsx');
  await mount(WatchQueryPanel,{initialQuery:request.query,active:true});
  assert.equal(tree.root.findByType('input').props.value,action.query);
  const links=tree.root.findAllByType('a');
  assert.equal(new URL(links[0].props.href).hostname,'search.bilibili.com');
  assert.equal(new URL(links[0].props.href).searchParams.get('keyword'),action.query);
  assert.equal(decodeURIComponent(new URL(links[1].props.href).pathname.slice(6)),action.query);
  assert.ok(JSON.stringify(tree.toJSON()).includes('不会替换本场内容'));
  await act(async()=>tree.root.findByType('input').props.onChange({target:{value:'  '}}));
  assert.equal(tree.root.findAllByType('a').length,0);await unmount();
  let draft='既有草稿不能被覆盖';
  await mount(TakeoutQueryPanel,{initialQuery:'虚构烧烤，预算30',onPrepare:query=>{draft=appendActivityDraft(draft,'帮我搜索外卖店铺：'+query);}});
  assert.equal(tree.root.findByType('textarea').props.value,'虚构烧烤，预算30');
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'虚构餐品，不辣，预算50'}}));
  await act(async()=>tree.root.findByType('button').props.onClick());
  assert.equal(draft,'既有草稿不能被覆盖\n\n帮我搜索外卖店铺：虚构餐品，不辣，预算50');await unmount();
  const {default:Together}=await vite.ssrLoadModule('/src/Together.jsx');
  const page={provider:'web_page',page_url:'https://video.example.test/watch',embed_url:'https://player.example.test/embed',title:'虚构影片',embed_likely_blocked:true};
  const key='dengta_together_web_page_v2:'+JSON.stringify(['account-a','companion-a']);storage.set(key,JSON.stringify(page));
  let starts=0;
  const props={accountScope:'account-a',companionScope:'companion-a',watchRequest:request,screenState:{},feedback:{},preview:{},receipt:{},onStartDirect:async data=>{starts++;assert.equal(data.mediaUrl,page.page_url);return {ok:true};}};
  await mount(Together,props);
  assert.equal(tree.root.findByType('iframe').props.src,page.embed_url);
  assert.equal(tree.root.findAllByType('a').find(node=>node.props.className?.includes('together-web-open')).props.href,page.page_url);
  assert.ok(JSON.stringify(tree.toJSON()).includes('该网站自身不支持外部内嵌'));
  assert.equal(starts,0);
  await act(async()=>tree.root.findAllByType('button').find(node=>node.children.some(child=>child==='开始网页一起看')).props.onClick());assert.equal(starts,1);await unmount();
  await mount(Together,{...props,companionScope:'companion-b',watchRequest:activityRequestInScope(request,'account-a','companion-b')});
  assert.equal(tree.root.findAllByType('iframe').length,0);assert.ok(!JSON.stringify(tree.toJSON()).includes(action.query));await unmount();
  storage.clear();let release;let signal;
  globalThis.__watchFixture.resolve=(_url,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});};
  await mount(Together,props);
  await act(async()=>tree.root.findAllByType('button').find(node=>node.props.role==='tab'&&node.children.some(child=>child==='网页一起看')).props.onClick());
  const urlInput=tree.root.findAllByType('input').find(node=>node.props.type==='url');
  await act(async()=>urlInput.props.onChange({target:{value:page.page_url}}));
  await act(async()=>tree.root.findAllByType('button').find(node=>node.children.some(child=>child==='解析并载入')).props.onClick());
  await unmount();assert.equal(signal.aborted,true);await act(async()=>release(page));assert.equal(storage.has(key),false);
  storage.clear();
  storeDirectMediaSession(globalThis.sessionStorage,'account-a',{url:'https://media.example.test/video.mp4',positionSeconds:42,durationSeconds:120},'companion-a');
  await mount(Together,props);
  assert.equal(tree.root.findByType('video').props.src,'https://media.example.test/video.mp4');
  await act(async()=>tree.root.findByType('video').props.onError({currentTarget:{error:{code:2}}}));
  assert.ok(!JSON.stringify(tree.toJSON()).includes('media_network'),'foreign media nodes must not add a current-player error');
  for(const code of [1,2,3,4,0]) {
    mediaNode.error={code,message:'PRIVATE_MEDIA_URL'};
    await act(async()=>tree.root.findByType('video').props.onError({currentTarget:mediaNode}));
    assert.ok(JSON.stringify(tree.toJSON()).includes(mediaPlaybackFeedback({code}).code));
    assert.ok(!JSON.stringify(tree.toJSON()).includes('PRIVATE_MEDIA_URL'));
    const before=reloads;
    await act(async()=>tree.root.findAllByType('button').find(node=>node.children.some(child=>child==='重新载入视频')).props.onClick());
    assert.equal(reloads,before+1);
  }
  await unmount();await mount(Together,{...props,companionScope:'companion-b'});
  assert.equal(tree.root.findAllByType('video').length,0);await unmount();
  storage.set(key,JSON.stringify({...page,provider:'bilibili',bvid:'BV1234567890'}));
  await mount(Together,props);
  mediaNode.error={code:2}; await act(async()=>tree.root.findByType('video').props.onError({currentTarget:mediaNode}));
  assert.ok(JSON.stringify(tree.toJSON()).includes('media_network'));
  const before=reloads;
  await act(async()=>tree.root.findAllByType('button').find(node=>node.children.some(child=>child==='重新载入视频')).props.onClick());
  assert.equal(reloads,before+1);assert.equal(starts,1);
  console.log('Activity query and playback flow passed: scoped recovery, media error codes, manual reload, no automatic session or playback');
}finally{
  await unmount();await vite.close();
  for(const [name,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}
