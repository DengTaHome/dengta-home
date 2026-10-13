import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const native = (file) => fs.readFileSync(new URL(`../android/app/src/main/java/home/dengta/app/${file}.java`, import.meta.url), 'utf8');
const activity = native('CastPlayerActivity');
const method = (name) => {
  const declaration = new RegExp(`(?:public|protected|private) void ${name}\\([^)]*\\)\\s*\\{`).exec(activity);
  assert.ok(declaration, `${name} must exist`);
  const start = declaration.index;
  const open = activity.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  while (depth && end < activity.length) {
    if (activity[end] === '{') depth++;
    if (activity[end] === '}') depth--;
    end++;
  }
  return activity.slice(open + 1, end - 1);
};

// Source contracts guard Android wiring; they do not emulate Activity scheduling.
test('opening or reattaching a window cannot send another playback command', () => {
  for (const name of ['onCreate', 'onNewIntent', 'onServiceConnected', 'bindPlaybackService', 'onResume', 'refreshPlaybackUi']) {
    assert.doesNotMatch(method(name), /CastPlaybackService\.play\(|\.play\(|\.prepare\(|\.seekTo\(|\.setPlayWhenReady\(/, name);
  }
  assert.equal((activity.match(/CastPlaybackService\.play\(/g) || []).length, 1);
  assert.match(method('replayVideo'), /CastPlaybackService\.play\(/, 'explicit replay retains its fallback');
  for (const file of ['DlnaReceiverPlugin', 'VideoExtractorActivity']) {
    const source = native(file);
    const start = source.indexOf('CastPlaybackService.play(');
    assert.notEqual(start, -1);
    assert.ok(start < source.indexOf('new Intent(', start), `${file} starts playback before opening its window`);
  }
});

test('recreation restores presentation but never replays a window action', () => {
  const create = method('onCreate');
  const save = method('onSaveInstanceState');
  assert.match(create, /savedInstanceState != null && savedInstanceState.getBoolean\(STATE_FULLSCREEN\)/);
  assert.match(create, /if \(restoreFullscreen\) toggleFullscreen\(\)/);
  assert.match(create, /if \(savedInstanceState == null && intent != null && intent.hasExtra\(EXTRA_WINDOW_ACTION\)\) queueWindowAction\(intent\)/);
  for (const key of ['EXTRA_URI', 'EXTRA_TITLE', 'EXTRA_USER_NAME', 'EXTRA_AI_NAME']) {
    assert.ok(create.includes(`savedInstanceState.getString(${key},`));
    assert.ok(save.includes(`state.putString(${key},`));
  }
  assert.doesNotMatch(save, /EXTRA_WINDOW_(ACTION|REQUEST)/);
});

test('notification reopening retains the existing media and refreshes service state', () => {
  assert.match(method('onNewIntent'), /if \(intent == null \|\| !intent.hasExtra\(EXTRA_URI\)\) \{\s*refreshPlaybackUi\(\);\s*return;/);
  const refresh = method('refreshPlaybackUi');
  for (const read of ['getOriginalUri()', 'getCurrentTitle()', 'getVideoSize()', 'getPlayWhenReady()', 'getPlaybackState()', 'getPlayerError()']) assert.ok(refresh.includes(read));
  assert.match(refresh, /showError\("播放会话已结束/);
});

test('background ready events cannot restart progress polling', () => {
  assert.match(method('showPlaying'), /if \(windowResumed && !progressHandler.hasCallbacks\(progressRunnable\)\)/);
  assert.match(activity, /if \(!windowResumed \|\| isDestroyed\(\) \|\| isFinishing\(\)\) return;\s*updateProgress\(\);\s*progressHandler.removeCallbacks\(this\);\s*progressHandler.postDelayed\(this, 500\)/);
  for (const name of ['onPause', 'onDestroy']) {
    assert.match(method(name), /progressHandler.removeCallbacks\(progressRunnable\)/);
    assert.match(method(name), /controlHandler.removeCallbacks\(autoHideControls\)/);
  }
});

test('playback service owns proxy cleanup and retains position during fallback', () => {
  const service = native('CastPlaybackService');
  assert.match(service, /localProxy = LocalMediaProxy.startRandom\(uri\)/);
  assert.match(service, /String proxyUrl = localProxy.getProxyUrl\(\)/);
  assert.match(service, /player.setMediaSource\(mediaSource, resumePosition\)/);
  assert.match(service, /player.setPlayWhenReady\(resumePlaying\)/);
  assert.match(service, /if \(ACTION_STOP.equals\(action\)\) \{[\s\S]*?player.clearMediaItems\(\);[\s\S]*?originalUri = "";[\s\S]*?closeLocalProxy\(\);/);
  assert.match(service, /public void onDestroy\(\) \{[\s\S]*?closeLocalProxy\(\);/);
  assert.match(service, /boolean sameMedia = uri.equals\(originalUri\)/, 'proxy media URL must not defeat original-media identity');
});
