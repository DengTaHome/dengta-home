import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createStoryChapter, createStoryChaptersStore, downloadStoryBook, downloadStoryChapter, storyChapterError, storyChapterFeedback, storyScopeKey } from "./story-chapters.js";
import "./story-chapters.css";

export default function StoryChapters(props) {
  return <StoryChaptersView key={JSON.stringify([props.accountScope,props.companionScope])} {...props} />;
}

function StoryChaptersView({ accountScope, companionScope, storage }) {
  const scope=useMemo(()=>({accountScope,companionScope}),[accountScope,companionScope]);
  const resource=useMemo(()=>{try{return {store:createStoryChaptersStore(scope,storage),key:storyScopeKey(scope)};}catch(error){return {error};}},[scope,storage]);
  const [chapters,setChapters]=useState([]),[title,setTitle]=useState(""),[body,setBody]=useState("");
  const [feedback,setFeedback]=useState(""),[undo,setUndo]=useState(null),[editing,setEditing]=useState(null),[loaded,setLoaded]=useState(false);
  const context=useRef(null),id=useId();
  useLayoutEffect(()=>{context.current=resource;return ()=>{context.current=null;};},[resource]);
  const current=()=>context.current===resource && !resource.error;
  const action=invoke=>{
    if(!current())return;
    try{invoke(resource.store);}catch(error){setFeedback(storyChapterFeedback(error));}
  };
  const refresh=()=>action(store=>{setChapters(store.read());setLoaded(true);setFeedback("已读取本机章节。");});
  const onOpen=event=>{if(event.currentTarget.open)refresh();};
  const save=event=>{event.preventDefault();action(store=>{
    const chapter=createStoryChapter(title,body);
    setChapters(store.add(chapter));setLoaded(true);setTitle("");setBody("");setFeedback("章节已保存到本机。原聊天和 AI 记忆没有改变。");
  });};
  const exportDraft=()=>action(()=>{
    if(!body.trim())throw storyChapterError("story_chapter_invalid");
    downloadStoryChapter(createStoryChapter(title.trim() ? title : "故事草稿",body));setFeedback("草稿已交给文件保存流程，请确认文件保存结果。");
  });
  const exportBook=()=>action(store=>{
    downloadStoryBook(store.read());setFeedback("整本故事已交给文件保存流程，仅含已保存章节；请确认文件保存结果。");
  });
  return <section className="feature-page story-chapters" aria-labelledby={`${id}-heading`}>
    <details onToggle={onOpen}>
      <summary><span><small>你们的片段收藏</small><strong id={`${id}-heading`}>故事章节</strong></span><span aria-hidden="true">＋</span></summary>
      <p>把喜欢的聊天片段粘贴进来，组成一本只属于你们的故事。仅保存在本机、当前账号和伴侣下；清除网站资料会丢失，请定期导出。</p>
      <form onSubmit={save}>
        <label htmlFor={`${id}-title`}>章节名称</label><input id={`${id}-title`} value={title} onChange={event=>setTitle(event.target.value)} placeholder="例如：月光下的第一场冒险" />
        <label htmlFor={`${id}-body`}>你选的片段</label><textarea id={`${id}-body`} rows={5} value={body} onChange={event=>setBody(event.target.value)} placeholder="粘贴想收藏的原文；不会自动提取聊天或发送给 AI。" />
        <div className="story-chapter-actions"><button type="submit" disabled={!!resource.error}>保存为章节</button><button type="button" onClick={exportDraft} disabled={!body || !!resource.error}>导出草稿</button><button type="button" onClick={refresh} disabled={!!resource.error}>刷新章节</button></div>
      </form>
      {loaded && chapters.length>0 && <div className="story-chapter-actions story-book-export"><button type="button" onClick={exportBook} disabled={!!resource.error}>导出整本故事</button><span>已保存 {chapters.length} 篇 · 按当前顺序导出 TXT，不含未保存草稿。</span></div>}
      {(resource.error || feedback) && <p role="status" className="story-chapter-feedback">{resource.error ? storyChapterFeedback(resource.error) : feedback}</p>}
      {undo && <div className="story-chapter-undo"><span>已移除「{undo.chapter.title}」</span><button type="button" onClick={()=>action(store=>{setChapters(store.restore(undo));setUndo(null);setFeedback("已恢复这篇章节。");})}>撤销移除</button></div>}
      <ol className="story-chapter-list">
        {chapters.map((chapter,index)=><li key={chapter.id}>
          <details><summary><span>第 {index+1} 章 · {chapter.title}</span></summary><pre>{chapter.body}</pre></details>
          {editing?.id===chapter.id && <form onSubmit={event=>{event.preventDefault();action(store=>{setChapters(store.rename(chapter.id,editing.title));setEditing(null);setFeedback("章节名称已保存，正文保持原样。");});}}>
            <label htmlFor={`${id}-rename`}>新的章节名称</label><input id={`${id}-rename`} value={editing.title} onChange={event=>setEditing({...editing,title:event.target.value})} />
            <div className="story-chapter-actions"><button type="submit">保存名称</button><button type="button" onClick={()=>setEditing(null)}>取消改名</button></div>
          </form>}
          <div className="story-chapter-actions">
            <button type="button" onClick={()=>{if(current())setEditing({id:chapter.id,title:chapter.title});}}>改名</button>
            <button type="button" disabled={index===0} onClick={()=>action(store=>{setChapters(store.move(chapter.id,"up"));setFeedback("章节已上移。");})}>上移</button>
            <button type="button" disabled={index===chapters.length-1} onClick={()=>action(store=>{setChapters(store.move(chapter.id,"down"));setFeedback("章节已下移。");})}>下移</button>
            <button type="button" onClick={()=>action(store=>{const latest=store.read().find(item=>item.id===chapter.id);if(!latest)throw storyChapterError("story_chapter_missing");downloadStoryChapter(latest);setFeedback("章节已交给文件保存流程，请确认文件保存结果。");})}>导出正文</button>
            <button type="button" onClick={()=>action(store=>{const result=store.remove(chapter.id);setChapters(result.chapters);setUndo(result.undo);if(editing?.id===chapter.id)setEditing(null);setFeedback("章节已从本机移除，可撤销本次操作。");})}>移除</button>
          </div>
        </li>)}
      </ol>
      {loaded && !chapters.length && <p className="story-chapter-empty">还没有章节。从一段喜欢的对话开始就好。</p>}
    </details>
  </section>;
}
