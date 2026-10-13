import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { VISIBLE_MONOLOGUE_SOURCE } from '../src/inner-monologue.js';
import { temporaryReplyOnFailure } from '../src/chat-errors.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = new EventTarget();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let view;
try {
  const { ThinkingPanel } = await server.ssrLoadModule('/src/ChatMessageExtras.jsx');
  let requested = 0;
  const props = {
    message: { id: 'saved-message', role: 'assistant', content: 'Reply.', isStreaming: false },
    innerMonologue: { state: 'missing', text: '', source: VISIBLE_MONOLOGUE_SOURCE },
    onRequestInnerMonologue: () => { requested += 1; },
  };
  await act(async () => { view = TestRenderer.create(React.createElement(ThinkingPanel, props)); });
  const button = view.root.findAllByType('button').find(node => node.children.includes('补充这次心声'));
  assert.ok(button, 'missing optional monologue has a recovery action');
  await act(async () => button.props.onClick());
  assert.equal(requested, 1);
  for (const state of ['complete', 'truncated', 'failed']) {
    await act(async () => view.update(React.createElement(ThinkingPanel, { ...props, innerMonologue: { ...props.innerMonologue, state } })));
    const retry = view.root.findAllByType('button').find(node => node.children.includes('补充这次心声'));
    assert.ok(retry, `${state} without text has a recovery action`);
    await act(async () => retry.props.onClick());
  }
  assert.equal(requested, 4);
  await act(async () => view.update(React.createElement(ThinkingPanel, { ...props, innerMonologuePending: true })));
  assert.equal(view.root.findAllByType('button').find(node => node.children.includes('正在补充心声…')).props.disabled, true);
  await act(async () => view.update(React.createElement(ThinkingPanel, { ...props, innerMonologueError: '[provider_balance_insufficient] API balance is insufficient.' })));
  const dialog = view.root.findByProps({ role: 'dialog' });
  assert.match(dialog.findByProps({ role: 'alert' }).findByType('p').children.join(''), /provider_balance_insufficient/);
  const dialogRetry = dialog.findAllByType('button').find(node => node.children.includes('再试一次'));
  assert.ok(dialogRetry, 'missing synchronized monologue exposes the supplement error and retry in the open dialog');
  await act(async () => dialogRetry.props.onClick());
  assert.equal(requested, 5);
  await act(async () => { view.update(React.createElement(ThinkingPanel, { ...props, message: { ...props.message, chatError: true }, innerMonologue: { ...props.innerMonologue, state: 'failed', text: 'Temporary thought' } })); });
  assert.match(JSON.stringify(view.toJSON()), /未确认保存/);
  assert.ok(!view.root.findAllByType('button').some(node => node.children.includes('补充这次心声')));
} finally {
  if (view) await act(async () => view.unmount());
  await server.close();
  delete globalThis.document;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
assert.equal(temporaryReplyOnFailure({ content: 'Partial body' }, { code: 'chat_stream_interrupted' }), 'Partial body');
assert.equal(temporaryReplyOnFailure({ content: 'Should be removed' }, { code: 'provider_boundary_residue' }), '');
assert.equal(temporaryReplyOnFailure({ content: 'Should be removed' }, { code: 'provider_error_document' }), '');
assert.equal(temporaryReplyOnFailure({ content: 'Error label', partialContent: 'Partial body', chatError: true }, { code: 'provider_stream_incomplete' }), 'Partial body');
console.log('monologue recovery UI and temporary reply tests passed');
