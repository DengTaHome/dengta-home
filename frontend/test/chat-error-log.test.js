import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let view;
try {
  const {default: Log} = await server.ssrLoadModule('/src/ChatErrorLog.jsx');
  let requests = 0;
  const diagnostic = { error_code: 'request_timeout', error_location: 'server.js:12:2' };
  const loadLog = async () => { if (++requests === 1) throw Object.assign(new Error('private upstream text'), {status:503}); return {id:'test',error_code:'provider_error_document', upstream_status:522,request_summary:{version:'0.29.5'}}; };
  await act(async()=>{view=TestRenderer.create(React.createElement(Log,{logId:'test',diagnostic,loadLog}));});
  await act(async()=>view.root.findAllByType('button')[0].props.onClick());
  assert.match(JSON.stringify(view.toJSON()), /重试读取日志/);
  assert.match(JSON.stringify(view.toJSON()), /server.js:12:2/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /private upstream text/);
  await act(async()=>view.root.findAllByType('button')[1].props.onClick());
  assert.equal(requests,2); assert.match(JSON.stringify(view.toJSON()), /522/);
  assert.match(JSON.stringify(view.toJSON()), /0.29.5/);
  await act(async()=>view.unmount());
  await act(async()=>{view=TestRenderer.create(React.createElement(Log,{diagnostic,loadLog}));});
  await act(async()=>view.root.findAllByType('button')[0].props.onClick());
  assert.match(JSON.stringify(view.toJSON()), /没有收到服务器日志编号/); assert.equal(requests,2);
  await act(async()=>view.unmount());
  for(const failure of [null, Object.assign(new Error(),{status:401}),Object.assign(new Error(),{code:'request_timeout'})]) {
    await act(async()=>{view=TestRenderer.create(React.createElement(Log,{logId:'test',diagnostic,loadLog:async()=>{if(failure)throw failure;return null;}}));});
    await act(async()=>view.root.findAllByType('button')[0].props.onClick());
    assert.match(JSON.stringify(view.toJSON()), /重试读取日志/);
    await act(async()=>view.unmount());
  }
} finally {if(view)await act(async()=>view.unmount());await server.close();delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
console.log('Error log retry, null/404, auth, timeout, local fallback and privacy tests passed');
