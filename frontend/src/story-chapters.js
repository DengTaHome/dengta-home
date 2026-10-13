import { accountStorageKey } from "./account-storage.js";

const BASE_KEY = "dengta_story_chapters_v1";
const MESSAGES = Object.freeze({
  story_scope_missing: "请先选择当前账号和伴侣，再打开故事章节。",
  story_scope_changed: "账号、伴侣或页面已切换，旧章节操作已取消。",
  story_storage_unavailable: "本机存储不可用或空间不足，章节未保存。输入仍保留，请先导出草稿再重试。",
  story_storage_invalid: "本机章节资料格式异常，原资料未改写。请重试读取。",
  story_chapter_invalid: "请填写章节名称和正文，再保存。",
  story_chapter_missing: "这篇章节已被移除，请刷新列表后再操作。",
  story_book_empty: "还没有已保存的章节。先保存一篇，或单独导出当前草稿。",
  story_export_failed: "未能导出文件，请检查浏览器下载权限后重试。章节和草稿仍保留。",
});
export function storyChapterError(code) {
  return Object.assign(new Error(MESSAGES[code] || MESSAGES.story_chapter_invalid), { code });
}
export function storyChapterFeedback(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : "story_chapter_invalid";
  return `${MESSAGES[code]}（错误代码：${code}）`;
}
const text = (value, required = false) => typeof value === "string" && (!required || value.trim().length > 0);
export function storyScopeKey(scope) {
  if (!text(scope?.accountScope, true) || !text(scope?.companionScope, true)) throw storyChapterError("story_scope_missing");
  return accountStorageKey(BASE_KEY, JSON.stringify([scope.accountScope, scope.companionScope]));
}
function chapterRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !text(value.id, true) ||
    !text(value.title, true) || !text(value.body, true) || !text(value.createdAt, true) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw storyChapterError("story_chapter_invalid");
  }
  return Object.freeze({id:value.id,title:value.title,body:value.body,createdAt:value.createdAt});
}
export function createStoryChapter(title, body, { id = globalThis.crypto?.randomUUID?.(), createdAt = new Date().toISOString() } = {}) {
  return chapterRecord({ id:id || `chapter-${Date.now()}-${Math.random().toString(36).slice(2)}`, title, body, createdAt });
}
export function createStoryChaptersStore(scope, suppliedStorage) {
  const key = storyScopeKey(scope);
  const storage = () => {
    try {
      const value = suppliedStorage || globalThis.localStorage;
      if (!value?.getItem || !value?.setItem) throw new Error();
      return value;
    } catch { throw storyChapterError("story_storage_unavailable"); }
  };
  const read = () => {
    let raw;
    try { raw = storage().getItem(key); } catch { throw storyChapterError("story_storage_unavailable"); }
    if (raw === null || raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || parsed.accountScope !== scope.accountScope || parsed.companionScope !== scope.companionScope || !Array.isArray(parsed.chapters)) throw new Error();
      const chapters = parsed.chapters.map(chapterRecord);
      if (new Set(chapters.map(chapter => chapter.id)).size !== chapters.length) throw new Error();
      return chapters;
    } catch { throw storyChapterError("story_storage_invalid"); }
  };
  const write = chapters => {
    try { storage().setItem(key, JSON.stringify({version:1,accountScope:scope.accountScope,companionScope:scope.companionScope,chapters})); }
    catch { throw storyChapterError("story_storage_unavailable"); }
    return chapters;
  };
  const locate = (chapters,id) => {
    const index = chapters.findIndex(chapter => chapter.id === id);
    if (index < 0) throw storyChapterError("story_chapter_missing");
    return index;
  };
  return Object.freeze({
    read,
    add(value) {
      const chapter = chapterRecord(value), chapters = read();
      if (chapters.some(item => item.id === chapter.id)) return chapters;
      return write([...chapters,chapter]);
    },
    rename(id,title) {
      const chapters=read(),index=locate(chapters,id);
      chapters[index]=chapterRecord({...chapters[index],title});
      return write(chapters);
    },
    move(id,direction) {
      const chapters=read(),index=locate(chapters,id),target=index+(direction === "up" ? -1 : direction === "down" ? 1 : 0);
      if(target<0 || target>=chapters.length || target===index)return chapters;
      [chapters[index],chapters[target]]=[chapters[target],chapters[index]];
      return write(chapters);
    },
    remove(id) {
      const chapters=read(),index=locate(chapters,id),removed=chapters[index];
      return {chapters:write(chapters.filter(item=>item.id!==id)),undo:{chapter:removed,index}};
    },
    restore(undo) {
      const chapter=chapterRecord(undo?.chapter),chapters=read();
      if(chapters.some(item=>item.id===chapter.id))return chapters;
      const index=Number.isInteger(undo?.index)?Math.max(0,Math.min(undo.index,chapters.length)):chapters.length;
      chapters.splice(index,0,chapter);
      return write(chapters);
    },
  });
}
export function exportStoryChapter(value) {
  const chapter=chapterRecord(value);
  const filename=Array.from(chapter.title).slice(0,80).map(character=>character.charCodeAt(0)<32||/[<>:"/\\|?*]/.test(character)?"_":character).join("");
  return {filename:`${filename}.txt`,text:chapter.body,type:"text/plain;charset=utf-8"};
}
export function exportStoryBook(values) {
  if (!Array.isArray(values)) throw storyChapterError("story_storage_invalid");
  if (!values.length) throw storyChapterError("story_book_empty");
  const chapters=values.map(chapterRecord);
  if (new Set(chapters.map(chapter=>chapter.id)).size!==chapters.length) throw storyChapterError("story_storage_invalid");
  return {filename:"DengTa-故事章节.txt",text:"灯塔 · 故事章节\n\n"+chapters.map((chapter,index)=>`第 ${index+1} 章 · ${chapter.title}\n\n${chapter.body}`).join("\n\n─────\n\n"),type:"text/plain;charset=utf-8"};
}
function downloadTextFile(file) {
  let url,anchor;
  try {
    if(typeof window.DengTaFileBridge?.saveExport === "function") {
      const bytes=new TextEncoder().encode(file.text);
      let binary="";
      for(let start=0;start<bytes.length;start+=16_384)binary+=String.fromCharCode(...bytes.subarray(start,start+16_384));
      window.DengTaFileBridge.saveExport("data:text/plain;charset=utf-8;base64,"+btoa(binary),file.filename);
      return;
    }
    url=URL.createObjectURL(new Blob([file.text],{type:file.type}));
    anchor=document.createElement("a");anchor.href=url;anchor.download=file.filename;
    document.body.append(anchor);anchor.click();
  } catch { throw storyChapterError("story_export_failed"); }
  finally {anchor?.remove();if(url)window.setTimeout(()=>URL.revokeObjectURL(url),30_000);}
}
export function downloadStoryChapter(value) {
  try { downloadTextFile(exportStoryChapter(value)); }
  catch { throw storyChapterError("story_export_failed"); }
}
export function downloadStoryBook(values) {
  downloadTextFile(exportStoryBook(values));
}
