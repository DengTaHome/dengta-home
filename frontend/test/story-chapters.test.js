import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import React,{act} from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { createStoryChapter,createStoryChaptersStore,exportStoryChapter,exportStoryBook,downloadStoryChapter,downloadStoryBook,storyScopeKey } from "../src/story-chapters.js";

const scope={accountScope:"fictional-account",companionScope:"fictional-companion"};
const storeFixture=()=>{
  const values=new Map();let failed=false;
  return {values,fail:value=>{failed=value;},getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(failed)throw Error("FICTIONAL_PRIVATE_STORAGE_ERROR");values.set(key,value);}};
};
const chapter=(id,body="  虚构章节\r\n 星灯🌙\t  ")=>createStoryChapter(`章 ${id}`,body,{id,createdAt:"2026-10-08T01:00:00Z"});

test("only explicit chapter operations write to the isolated namespace, preserving exact text",()=>{
  const storage=storeFixture();storage.values.set("user-private-prompt","FICTIONAL_UNCHANGED");
  const store=createStoryChaptersStore(scope,storage),original=chapter("a");
  assert.deepEqual(store.read(),[]);assert.equal(storage.values.size,1);
  store.add(original);assert.equal(store.read()[0].body,original.body);
  store.rename("a","  新标题  ");assert.equal(store.read()[0].title,"  新标题  ");assert.equal(store.read()[0].body,original.body);
  assert.equal(storage.values.get("user-private-prompt"),"FICTIONAL_UNCHANGED");
  for(const other of [{...scope,accountScope:"another-account"},{...scope,companionScope:"another-companion"}])assert.deepEqual(createStoryChaptersStore(other,storage).read(),[]);
});

test("reordering and undo read current storage and preserve unrelated newly added chapters",()=>{
  const storage=storeFixture(),first=createStoryChaptersStore(scope,storage),second=createStoryChaptersStore(scope,storage);
  first.add(chapter("a"));first.add(chapter("b"));second.add(chapter("c"));
  assert.deepEqual(first.move("b","up").map(item=>item.id),["b","a","c"]);
  const removed=first.remove("a");second.add(chapter("d"));
  assert.deepEqual(first.restore(removed.undo).map(item=>item.id),["b","a","c","d"]);
  assert.deepEqual(first.restore(removed.undo).map(item=>item.id),["b","a","c","d"]);
  assert.throws(()=>first.rename("missing","x"),{code:"story_chapter_missing"});
});

for(const raw of ["{",JSON.stringify({version:1,...scope,chapters:[null]}),JSON.stringify({version:1,...scope,accountScope:"other",chapters:[]})])test("corrupt or mismatched saved data cannot be overwritten",()=>{
  const storage=storeFixture(),key=storyScopeKey(scope);storage.values.set(key,raw);
  const store=createStoryChaptersStore(scope,storage);
  assert.throws(()=>store.read(),{code:"story_storage_invalid"});assert.throws(()=>store.add(chapter("a")),{code:"story_storage_invalid"});assert.equal(storage.values.get(key),raw);
});

test("full chapter export is lossless and native file bridge receives UTF8 bytes",()=>{
  const value=chapter("a"),file=exportStoryChapter({...value,title:'月亮/星灯?'});
  assert.equal(file.text,value.body);assert.equal(file.filename,"月亮_星灯_.txt");
  const previous=globalThis.window,calls=[];globalThis.window={DengTaFileBridge:{saveExport:(...args)=>calls.push(args)}};
  try{downloadStoryChapter(value);assert.equal(calls.length,1);const encoded=calls[0][0].split(",")[1];assert.equal(Buffer.from(encoded,"base64").toString("utf8"),value.body);}
  finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test("whole-book export preserves current order and all original title/body bytes without mutating records",()=>{
  const originals=Object.freeze([chapter("a","  第一段\r\n\r\n星河 🌌\t "),chapter("b","第二段\n末尾  ")]);
  const before=JSON.stringify(originals),file=exportStoryBook(originals);
  assert.equal(file.filename,"DengTa-故事章节.txt");assert.equal(file.type,"text/plain;charset=utf-8");
  for(const value of originals)assert.ok(file.text.includes(`${value.title}\n\n${value.body}`));
  assert.ok(file.text.indexOf(originals[0].body)<file.text.indexOf(originals[1].body));
  assert.equal(JSON.stringify(originals),before);
  assert.throws(()=>exportStoryBook([]),{code:"story_book_empty"});
  assert.throws(()=>exportStoryBook({chapters:originals}),{code:"story_storage_invalid"});
  assert.throws(()=>exportStoryBook([originals[0],originals[0]]),{code:"story_storage_invalid"});
});

test("whole-book native export spans base64 chunks losslessly and maps bridge failure to a public error",()=>{
  const originals=[chapter("large","🌙\t\r\n  ".repeat(6000)),chapter("b","最终原文\n  ")];
  const expected=exportStoryBook(originals).text,previous=globalThis.window,calls=[];
  globalThis.window={DengTaFileBridge:{saveExport:(...args)=>calls.push(args)}};
  try{
    downloadStoryBook(originals);assert.equal(calls.length,1);
    assert.equal(Buffer.from(calls[0][0].split(",")[1],"base64").toString("utf8"),expected);
    globalThis.window.DengTaFileBridge.saveExport=()=>{throw Error("FICTIONAL_PRIVATE_BRIDGE_ERROR");};
    assert.throws(()=>downloadStoryBook(originals),error=>error.code==="story_export_failed"&&!error.message.includes("PRIVATE"));
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

let vite,StoryChapters,tree;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
before(async()=>{vite=await createServer({envDir:false,logLevel:"silent",server:{middlewareMode:true},appType:"custom"});({default:StoryChapters}=await vite.ssrLoadModule("/src/StoryChapters.jsx"));});
after(async()=>{if(tree)await act(async()=>tree.unmount());await vite.close();});
const button=name=>tree.root.findAllByType("button").find(node=>node.children.join("")===name);
const mainDetails=()=>tree.root.findAllByType("details")[0];
const titleInput=()=>tree.root.findAllByType("input")[0];
const bodyInput=()=>tree.root.findByType("textarea");
const form=()=>tree.root.findAllByType("form")[0];
const json=()=>JSON.stringify(tree.toJSON());
async function mount(storage,extra={}){await act(async()=>{tree=TestRenderer.create(React.createElement(StoryChapters,{...scope,storage,...extra}));});}
async function open(){await act(async()=>mainDetails().props.onToggle({currentTarget:{open:true}}));}
async function fill(title,body){await act(async()=>{titleInput().props.onChange({target:{value:title}});bodyInput().props.onChange({target:{value:body}});});}
async function save(){await act(async()=>form().props.onSubmit({preventDefault(){}}));}
async function unmount(){await act(async()=>{tree.unmount();tree=null;});}

test("the actual component supports save, rename, preview, reorder, remove/undo and reopening",async()=>{
  const storage=storeFixture(),body="  虚构月光\n\n🌙  ";
  try{
    await mount(storage);assert.equal(storage.values.size,0);await open();await fill("初遇",body);await save();
    assert.equal(bodyInput().props.value,"");assert.equal(tree.root.findByType("pre").children.join(""),body);
    await act(async()=>button("改名").props.onClick());const renameForm=tree.root.findAllByType("form")[1];
    await act(async()=>renameForm.findByType("input").props.onChange({target:{value:"新的相遇"}}));
    await act(async()=>tree.root.findAllByType("form")[1].props.onSubmit({preventDefault(){}}));
    assert.ok(json().includes("新的相遇"));await fill("第二章","虚构星河");await save();
    const move=tree.root.findAllByType("button").filter(node=>node.children.join("")==="上移")[1];await act(async()=>move.props.onClick());
    assert.equal(tree.root.findAllByType("pre")[0].children.join(""),"虚构星河");
    await act(async()=>button("移除").props.onClick());assert.ok(button("撤销移除"));await act(async()=>button("撤销移除").props.onClick());
    assert.equal(tree.root.findAllByType("pre").length,2);await unmount();await mount(storage);await open();
    assert.deepEqual(tree.root.findAllByType("pre").map(node=>node.children.join("")),["虚构星河",body]);
  }finally{if(tree)await unmount();}
});

test("quota failure retains both draft inputs and saved chapters without leaking raw exceptions",async()=>{
  const storage=storeFixture();createStoryChaptersStore(scope,storage).add(chapter("saved"));
  try{await mount(storage);await open();await fill("待保存","  虚构草稿  ");storage.fail(true);await save();
    assert.equal(titleInput().props.value,"待保存");assert.equal(bodyInput().props.value,"  虚构草稿  ");
    assert.equal(tree.root.findByType("pre").children.join(""),chapter("saved").body);
    assert.ok(json().includes("story_storage_unavailable"));assert.ok(!json().includes("FICTIONAL_PRIVATE_STORAGE_ERROR"));
    storage.fail(false);await save();assert.equal(createStoryChaptersStore(scope,storage).read().length,2);
  }finally{if(tree)await unmount();}
});

test("book button reads current saved collection, excludes draft, preserves input and never writes storage",async()=>{
  const storage=storeFixture(),store=createStoryChaptersStore(scope,storage),calls=[],previous=globalThis.window;
  globalThis.window={DengTaFileBridge:{saveExport:(...args)=>calls.push(args)}};
  try{
    store.add(chapter("saved"));await mount(storage);await open();await fill("未保存名字","  FICTIONAL_DRAFT_NOT_FOR_BOOK  ");
    store.add(chapter("newly-added","  新保存原文\r\n✨  "));const before=storage.values.get(storyScopeKey(scope));
    await act(async()=>button("导出整本故事").props.onClick());assert.equal(calls.length,1);
    const exported=Buffer.from(calls[0][0].split(",")[1],"base64").toString("utf8");
    assert.ok(exported.includes(chapter("saved").body));assert.ok(exported.includes("  新保存原文\r\n✨  "));
    assert.ok(!exported.includes("FICTIONAL_DRAFT_NOT_FOR_BOOK"));assert.equal(bodyInput().props.value,"  FICTIONAL_DRAFT_NOT_FOR_BOOK  ");
    assert.equal(titleInput().props.value,"未保存名字");assert.equal(storage.values.get(storyScopeKey(scope)),before);
    assert.ok(json().includes("仅含已保存章节"));
  }finally{if(tree)await unmount();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test("book export refuses a changed corrupt collection and a stale scoped handler without losing drafts",async()=>{
  const storage=storeFixture(),calls=[],previous=globalThis.window;
  globalThis.window={DengTaFileBridge:{saveExport:(...args)=>calls.push(args)}};
  try{
    createStoryChaptersStore(scope,storage).add(chapter("saved"));await mount(storage);await open();await fill("草稿","虚构仍保留");
    const oldExport=button("导出整本故事").props.onClick;storage.values.set(storyScopeKey(scope),"{");
    await act(async()=>oldExport());assert.equal(calls.length,0);assert.ok(json().includes("story_storage_invalid"));
    assert.equal(bodyInput().props.value,"虚构仍保留");assert.equal(storage.values.get(storyScopeKey(scope)),"{");
    await act(async()=>tree.update(React.createElement(StoryChapters,{...scope,companionScope:"new-fictional-companion",storage})));
    await act(async()=>oldExport());assert.equal(calls.length,0);assert.equal(storage.values.get(storyScopeKey(scope)),"{");
  }finally{if(tree)await unmount();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test("scope switching clears old local UI and makes old save and delete handlers inert",async()=>{
  const storage=storeFixture();createStoryChaptersStore(scope,storage).add(chapter("saved"));
  try{await mount(storage);await open();await fill("旧草稿","虚构旧正文");const oldSave=form().props.onSubmit,oldDelete=button("移除").props.onClick;
    await act(async()=>tree.update(React.createElement(StoryChapters,{...scope,accountScope:"new-account",storage})));
    assert.equal(titleInput().props.value,"");assert.equal(bodyInput().props.value,"");assert.equal(tree.root.findAllByType("pre").length,0);
    await act(async()=>{oldSave({preventDefault(){}});oldDelete();});assert.equal(createStoryChaptersStore(scope,storage).read().length,1);
    await open();assert.ok(json().includes("还没有章节"));await unmount();await act(async()=>oldSave({preventDefault(){}}));assert.equal(storage.values.size,1);
  }finally{if(tree)await unmount();}
});

test("unread or corrupt storage is never mislabeled as an empty collection, and App integration stays isolated",async()=>{
  const storage=storeFixture();storage.values.set(storyScopeKey(scope),"{");
  try{await mount(storage);assert.ok(!json().includes("还没有章节"));await open();assert.ok(json().includes("story_storage_invalid"));assert.ok(!json().includes("还没有章节"));}
  finally{if(tree)await unmount();}
  const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.match(app,/const StoryChapters = lazy\(\(\) => import\("\.\/StoryChapters\.jsx"\)\)/);
  const diary=app.slice(app.indexOf("function renderDiary()"),app.indexOf("function renderNursery()"));
  assert.match(diary,/<StoryChapters key=\{privateMediaScope\} accountScope=\{accountStorageScope\} companionScope=\{companionScope\}/);
  assert.ok(!diary.includes("messages={"));
});
