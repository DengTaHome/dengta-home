import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resizeComposerInput} from '../src/composer-size.js';

test('the actual App observer refreshes scrollability when the viewport height limit changes without a width change',()=>{
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 const start=app.indexOf('  useLayoutEffect(() => {\n    const input = messageInputRef.current;');
 const windowsStart=app.indexOf('  useLayoutEffect(() => {\r\n    const input = messageInputRef.current;');
 const from=Math.max(start,windowsStart),end=app.indexOf('  const composerMenuTriggerRef',from);
 assert.ok(from>=0&&end>from);
 let maximum=176,callback,cleanup,disconnected=false,writes=0;
 const style={overflowY:'hidden'};
 Object.defineProperty(style,'height',{get:()=>style.value,set:value=>{style.value=value;writes++;}});
 const input={parentElement:{clientWidth:310},style,scrollHeight:132,ownerDocument:{defaultView:{getComputedStyle:()=>({minHeight:'44px',maxHeight:`${maximum}px`})}}};
 class Observer {constructor(fn){callback=fn;}observe(target){assert.equal(target,input.parentElement);}disconnect(){disconnected=true;}}
 const view={getComputedStyle:()=>({maxHeight:`${maximum}px`})};
 new Function('useLayoutEffect','ResizeObserver','window','messageInputRef','activeView','resizeComposerInput',app.slice(from,end))(
  fn=>{cleanup=fn();},Observer,view,{current:input},'chat',resizeComposerInput);
 callback([{contentRect:{width:310}}]); assert.equal(writes,0);
 maximum=112; callback([{contentRect:{width:310}}]);
 assert.equal(style.overflowY,'auto'); assert.equal(style.height,'112px');
 const measured=writes; callback([{contentRect:{width:310}}]); assert.equal(writes,measured,'height-only observer notifications must not create a measurement loop');
 maximum=176; callback([{contentRect:{width:310}}]); assert.equal(style.overflowY,'hidden');assert.equal(style.height,'132px');
 callback([{contentRect:{width:260}}]);assert.ok(writes>measured,'wrapped width changes still resize');
 cleanup();assert.equal(disconnected,true);
});
