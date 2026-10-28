#!/usr/bin/env node
// 归档 qq-bridge 离线自检创建的 DSH 会话（避免污染用户的 DSH 会话列表）。
// 用法：node archive-test-session.mjs <sessionId> [dshBaseUrl]
// 依赖：qq-bridge 仓库的 src/dsh-client.js（通过 QQ_BRIDGE_ROOT 定位）。
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionId = process.argv[2];
const baseUrl = process.argv[3] || process.env.DSH_BASE_URL || 'http://127.0.0.1:64020';
if (!sessionId) {
  console.error('用法：node archive-test-session.mjs <sessionId> [dshBaseUrl]');
  process.exit(2);
}
const bridgeRoot = process.env.QQ_BRIDGE_ROOT || process.argv[4] || 'D:\\GZdeepseek\\_refs\\qq\\qq-bridge';
const clientPath = path.join(bridgeRoot, 'src', 'dsh-client.js');
if (!fs.existsSync(clientPath)) {
  console.error(`找不到 ${clientPath}`);
  process.exit(2);
}
const { NodeApiClient, unwrap } = await import(pathToFileURL(clientPath).href);
const api = new NodeApiClient(baseUrl);
try {
  const result = unwrap(await api.workspace.archiveSession({ sessionId }), 'workspace/archiveSession');
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (error) {
  console.error(`归档会话失败：${error?.message ?? error}`);
  process.exit(1);
}
