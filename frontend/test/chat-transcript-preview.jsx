import {Profiler,useEffect,useRef,useState} from 'react';
import ChatTranscript from '../src/ChatTranscript.jsx';
import ChatMessage from '../src/ChatMessage.jsx';
import {getMessageSkinPresentation} from '../src/chat-skin.js';
import {createChatScrollController} from '../src/chat-scroll-controller.js';

const preferences={skin:'taotao-cream',ornamentActivity:'natural'};
function history(){return Array.from({length:120},(_,i)=>({id:String(i+1),role:i%2?'assistant':'user',content:`虚构记录 ${i+1}：一起看今天的云。`,created_at:'2026-10-01T01:00:00Z',...(i===119?{isStreaming:true}:{})}));}
export default function Preview(){
  const [messages,setMessages]=useState(history),[mode,setMode]=useState('optimized'),[report,setReport]=useState(null),[selected,setSelected]=useState('');
  const metrics=useRef({commits:0,actualMs:0}),timer=useRef(null),list=useRef(null),follow=useRef({current:true}),scroll=useRef(null);
  useEffect(()=>{scroll.current=createChatScrollController(list.current,follow.current);return()=>{scroll.current.dispose();clearInterval(timer.current);};},[]);
  useEffect(()=>scroll.current.sync(),[messages]);
  function stream(){
    clearInterval(timer.current);let count=0;metrics.current={commits:0,actualMs:0};setReport(null);
    timer.current=setInterval(()=>{count++;setMessages(current=>current.map((item,i)=>i===119?{...item,content:item.content+'星'}:item));if(count===60){clearInterval(timer.current);timer.current=null;}},20);
  }
  function invalidTime(){setMessages(current=>current.map((item,i)=>i===119?{...item,created_at:'fictional-invalid-time'}:item));}
  const common={aiName:'虚构伙伴',userName:'测试用户',onReference:item=>setSelected(item.id)};
  return <main className="app-shell transcript-preview" data-chat-skin="taotao-cream"><header><h1>聊天流式渲染验收</h1><p>120 条虚构记录，无账号、无模型调用。</p><label>渲染方式<select aria-label="渲染方式" value={mode} onChange={event=>setMode(event.target.value)}><option value="optimized">当前优化</option><option value="baseline">旧方式对照</option></select></label><button onClick={stream}>连续接收60个字</button><button onClick={invalidTime}>模拟异常消息时间</button><button onClick={()=>setReport({...metrics.current})}>查看测量</button><output aria-label="渲染测量">{report?JSON.stringify(report):'待测量'}</output><output aria-label="引用结果">{selected?`引用消息 ${selected}`:''}</output></header>
    <section ref={list} className="message-list" tabIndex={0} aria-label="虚构聊天记录"><div className="message-list-content"><Profiler id="transcript" onRender={(_id,_phase,duration)=>{metrics.current.commits++;metrics.current.actualMs+=duration;}}>
      {mode==='optimized'?<ChatTranscript messages={messages} preferences={preferences} {...common}/>:messages.map((item,index)=><ChatMessage key={item.id} item={item} skin={preferences.skin} skinPresentation={getMessageSkinPresentation(messages,index,preferences)} {...common}/>)}
    </Profiler></div></section>
  </main>;
}
