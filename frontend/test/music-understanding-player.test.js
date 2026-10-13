import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const identity = {accountScope:"fictional-understanding-player",companionScope:"fictional-companion"};
const first={id:"source-uuid-a",title:"虚构歌曲甲",artist:"虚构作者",provider_track_id:"1001",playback_mode:"external_netease"};
const second={...first,id:"source-uuid-b",title:"虚构歌曲乙",provider_track_id:"1002"};
const local={id:"source-uuid-local",title:"虚构本地音频",url:"https://media.example.test/local.mp3"};
const playlist={id:"playlist-uuid",name:"虚构歌单",items:[first,second,local]};
const session={id:"session-uuid",status:"active",sessionMode:"listening",musicPlaylistId:playlist.id,musicPlaylistItemId:first.id,revision:1};
const originalWindow=globalThis.window;
globalThis.window={setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:()=>null,setItem(){}}};
let calls, saved, tree, queue, narration, plays;
const fixture={auth:{getSnapshot:()=>({user:{id:identity.accountScope},activeCompanionId:identity.companionScope}),getRequestContext:async()=>({accessToken:"fictional-placeholder",companionId:identity.companionScope})},async request(path,options={}){
  calls.push({path,method:options.method||"GET",body:options.body?JSON.parse(options.body):null});
  if(path.endsWith("/music/playlists"))return {playlists:[playlist]};
  if(path.endsWith(`/playlists/${playlist.id}`))return {playlist};
  if(path.endsWith("/favorites"))return {favorites:[]};
  if(path.endsWith("/connections/manage"))return {connections:[]};
  if(path.endsWith("/cookie-session"))return {session:{connected:false}};
  if(path.endsWith("/queue"))return {queue};
  if(path.endsWith("/understanding/narration"))return narration(JSON.parse(options.body));
  if(path.endsWith("/understanding/analyze"))return {understanding:{cached:false,provider_track_id:JSON.parse(options.body).provider_track_id,title:first.title,artist:first.artist,analysis:{rhythm:{tempo_bpm:96}}}};
  throw Error("Unexpected fictional request "+path);
}};
globalThis.__musicUnderstandingPlayer=fixture;
const vite=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),configFile:false,envDir:false,appType:"custom",logLevel:"silent",server:{middlewareMode:true},plugins:[{name:"music-understanding-player-no-network",enforce:"pre",load(id){
  const path=id.replaceAll("\\","/");
  if(path.endsWith("/src/api.js"))return "export const apiRequest=(...args)=>globalThis.__musicUnderstandingPlayer.request(...args);export const apiFetch=apiRequest;export const fetchErrorLogById=apiRequest;";
  if(path.endsWith("/src/auth-session.js"))return "export const authSession=globalThis.__musicUnderstandingPlayer.auth;";
}}]});
const {default:TogetherMusic}=await vite.ssrLoadModule("/src/TogetherMusic.jsx");
const content=node=>typeof node==="string"?node:(node?.children||[]).map(content).join("");
const button=label=>tree.root.findAllByType("button").find(node=>content(node)===label);
const understandCalls=()=>calls.filter(call=>call.path.includes("/understanding/"));
const props=current=>({...identity,session:current,onUnderstandingSaved:receipt=>saved.push(receipt)});
async function mount(current=null,queueOverrides={}){
  calls=[];saved=[];plays=0;queue={session_id:session.id,current_queue_item_id:"queue-instance",revision:1,items:[{id:"queue-instance",playlist_id:playlist.id,item_id:first.id,title:first.title,provider_track_id:first.provider_track_id}],...queueOverrides};
  narration=body=>({result:{tier:body.tier,narration:"虚构听感文字",understanding:null}});
  await act(async()=>{tree=TestRenderer.create(React.createElement(TogetherMusic,props(current)),{createNodeMock:element=>element.type==="audio"?{load(){},pause(){},removeAttribute(){},play(){plays++;return Promise.resolve();}}:null});});
  if(!current)await selectPlaylist();
}
async function selectPlaylist(){await act(async()=>tree.root.findAllByType("select").find(node=>node.findAllByType("option").some(option=>option.props.value===playlist.id)).props.onChange({target:{value:playlist.id}}));}
async function choose(index){await act(async()=>tree.root.findAllByType("select").find(node=>node.findAllByType("option").some(option=>option.props.value===2)).props.onChange({target:{value:index}}));}
async function click(label){assert.ok(button(label),label);await act(async()=>button(label).props.onClick());}
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;});
after(async()=>{await vite.close();globalThis.window=originalWindow;delete globalThis.__musicUnderstandingPlayer;});

test("folded music understanding makes no analysis request and never starts playback",async()=>{
  await mount();assert.equal(understandCalls().length,0);assert.equal(plays,0);
  assert.equal(tree.root.findByProps({className:"music-understanding"}).findAllByType("details")[0].props.open,undefined);
});
test("player submits the provider ID rather than source UUID and refreshes only confirmed analysis",async()=>{
  await mount();await click("聊聊这首歌");assert.deepEqual(understandCalls()[0].body,{provider_track_id:"1001",title:first.title,artist:first.artist,tier:"casual"});assert.equal(saved.length,0);
  await click("分析并保存");assert.equal(saved.length,1);assert.equal(saved[0].providerTrackId,"1001");assert.equal(saved[0].scope,JSON.stringify([identity.accountScope,identity.companionScope]));assert.equal(plays,0);
  await choose(2);assert.equal(button("聊聊这首歌").props.disabled,true);assert.equal(button("分析并保存").props.disabled,true);
});
test("active queue fallback uses provider ID even when source details are unavailable",async()=>{
  await mount(session,{items:[{id:"queue-instance",playlist_id:playlist.id,item_id:"missing-source-uuid",title:first.title,provider_track_id:first.provider_track_id}]});
  await click("聊聊这首歌");
  assert.equal(understandCalls()[0].body.provider_track_id,"1001");assert.equal(plays,0);
});
test("playback revision keeps analysis but changing the selected source resets private results",async()=>{
  await mount(session);await click("分析并保存");
  assert.equal(button("生成专业解读").props.disabled,false);
  await act(async()=>tree.update(React.createElement(TogetherMusic,props({...session,revision:2,mediaPositionSeconds:33,playing:true}))));
  assert.equal(button("生成专业解读").props.disabled,false);assert.equal(understandCalls().length,1);
  await act(async()=>tree.update(React.createElement(TogetherMusic,props(null))));await selectPlaylist();await choose(1);
  assert.equal(button("生成专业解读"),undefined);assert.equal(saved.length,1);assert.equal(plays,0);
});
