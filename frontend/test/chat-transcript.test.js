import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';
import {getMessageSkinPresentation} from '../src/chat-skin.js';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const words=node=>typeof node==='string'?node:(Array.isArray(node)?node:node?.children||[]).map(words).join('');

test('real message render calls exclude unchanged history during deltas; latest actions and all presentation changes remain live',async()=>{
  const rendered=[],previousObserver=globalThis.__chatRenderObserver;
  globalThis.__chatRenderObserver=id=>rendered.push(id);
  const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{
    name:'observe-real-chat-render',enforce:'pre',transform(code,id){
      if(id.split('?')[0].endsWith('/src/ChatMessage.jsx')) {
        const marker='const isUser = item.role === "user";';assert.ok(code.includes(marker));
        return code.replace(marker,'globalThis.__chatRenderObserver?.(item.id);\n  '+marker);
      }
    }
  }]});let renderer;
  try {
    const {default:Message}=await vite.ssrLoadModule('/src/ChatMessage.jsx');
    const {default:Transcript}=await vite.ssrLoadModule('/src/ChatTranscript.jsx');
    const preferences={skin:'taotao-cream',ornamentActivity:'natural'};
    let messages=Array.from({length:120},(_,i)=>({id:String(i+1),role:i%2?'assistant':'user',content:'虚构正文 '+i,created_at:'2026-10-01T01:00:00Z',...(i===119?{isStreaming:true}:{})}));
    function baseline(){return messages.map((item,index)=>React.createElement(Message,{key:item.id,item,
      skin:preferences.skin,skinPresentation:getMessageSkinPresentation(messages,index,preferences),onReference:()=>{}}));}
    await act(async()=>{renderer=TestRenderer.create(React.createElement(React.Fragment,null,baseline()));});
    rendered.length=0;messages=messages.map((item,i)=>i===119?{...item,content:item.content+'字'}:item);
    await act(async()=>renderer.update(React.createElement(React.Fragment,null,baseline())));
    assert.equal(rendered.length,120,'the previous prop assembly defeats memo for every historical row');
    const baselineCalls=rendered.length;await act(async()=>renderer.unmount());renderer=null;
    let scope='a',selected,monologues={},pending={},errors={};
    function props(){const captured=scope;return {messages,preferences,innerMonologues:monologues,innerMonologuePending:pending,
      innerMonologueErrors:errors,aiName:'虚构伙伴',userName:'测试用户',onReference:item=>{selected=[captured,item.id];}};}
    await act(async()=>{renderer=TestRenderer.create(React.createElement(Transcript,props()));});
    rendered.length=0;
    for(const delta of ['你','好','🌟']) {
      messages=messages.map((item,i)=>i===119?{...item,content:item.content+delta}:item);
      await act(async()=>renderer.update(React.createElement(Transcript,props())));
      assert.ok(words(renderer.toJSON()).includes(messages[119].content),'the newest delta is visible after the current commit');
    }
    assert.deepEqual(rendered,['120','120','120']);
    scope='b';rendered.length=0;await act(async()=>renderer.update(React.createElement(Transcript,props())));
    assert.deepEqual(rendered,[],'callback refresh alone does not repaint messages');
    renderer.root.findAll(n=>n.type==='button'&&n.props['aria-label']==='引用测试用户的这条消息')[0].props.onClick();
    assert.deepEqual(selected,['b','1'],'retained rows must invoke the latest committed scope');
    rendered.length=0;monologues={'2':{text:'虚构心声',createdAt:'2026-10-01T01:00:00Z'}};
    await act(async()=>renderer.update(React.createElement(Transcript,props())));assert.deepEqual(rendered,['2']);
    assert.ok(words(renderer.toJSON()).includes('虚构心声'));
    rendered.length=0;pending={'2':true};errors={'2':'synthetic-error'};
    await act(async()=>renderer.update(React.createElement(Transcript,props())));assert.deepEqual(rendered,['2']);
    rendered.length=0;messages=[...messages,{id:'121',role:'assistant',content:'相邻新回复'}];
    await act(async()=>renderer.update(React.createElement(Transcript,props())));assert.deepEqual(rendered,['120','121']);
    rendered.length=0;await act(async()=>renderer.update(React.createElement(Transcript,{...props(),preferences:{...preferences,ornamentActivity:'quiet'},userAvatar:'synthetic-avatar',companionMood:'期待',aiName:'新昵称',aiPronoun:'她'})));
    assert.equal(rendered.length,121,'theme, avatar, name and mood changes remain visible to every row');
    console.log(JSON.stringify({history:120,baselineRenderCallsPerDelta:baselineCalls,optimizedRenderCallsPerDelta:1,deltaCommits:3}));
  } finally {if(renderer)await act(async()=>renderer.unmount());await vite.close();globalThis.__chatRenderObserver=previousObserver;}
});
