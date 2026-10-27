#!/usr/bin/env node
/**
 * 零引用模块检查。
 *
 * 为什么需要它：这个仓库出现过多次「代码写了、测试绿了、但没有任何人渲染」的情况——
 *   · XinchaoCapsule / XinchaoDetails —— 组件和测试都在，App 里零引用
 *   · SlidingIndicator —— 甚至 CSS 里都为它写好了选择器，容器却不存在
 *   · streaming-partial.js —— 方案改掉后没人删，测试还在为它背书
 *
 * 这类问题不会让任何测试变红，只会让功能对用户不可见。所以把它做成一项检查：
 * src 顶层的每个模块都必须至少被一个别的文件引用，否则必须进 ALLOWED 并写明理由。
 *
 * 用法：node scripts/check-orphan-modules.mjs [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "src");

/**
 * 允许「没有引用者」的模块。加新条目必须写清理由，否则下次检查还是会提醒你。
 */
const ALLOWED = new Map([
    ["main.jsx", "应用入口，由 index.html 以 <script src=\"/src/main.jsx\"> 加载"],
    ["visual-preview.jsx", "只在本地预览脚手架里用，不进正式包"],
    [
        "NeteaseQrLogin.jsx",
        "与当前设计冲突：设置里明确写着「登录只可在自托管管理页完成，DengTa 不调用 cloud_music_login，也不接收 Cookie」，" +
            "而这个组件正是做扫码登录的。属于废弃实现，删除需要产品确认，所以先不接线、只登记。"
    ],
    [
        "netease-cookie.js",
        "同上，属于被废弃的网易云登录路径的一部分，仅被 NeteaseQrLogin 使用（而后者也未接线）。"
    ]
]);

function listFiles(dir, extensionPattern) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            out.push(...listFiles(full, extensionPattern));
        } else if (extensionPattern.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const sourceFiles = listFiles(SRC, /\.(js|jsx)$/);
const htmlFiles = listFiles(ROOT, /\.html$/).filter((file) => !file.includes("node_modules"));
const testFiles = listFiles(path.join(ROOT, "test"), /\.(js|mjs)$/);

// 把 src 顶层模块单独列出来：这些才是「应当有引用者」的候选。
const topLevel = sourceFiles.filter((file) => path.dirname(file) === SRC);

// 所有可能包含 import 的文本
const haystack = [...sourceFiles, ...htmlFiles, ...testFiles]
    .map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));

function importersFor(moduleFile) {
    const base = path.basename(moduleFile, path.extname(moduleFile));
    const specifiers = [`"./${base}"`, `'./${base}'`, `"./${base}.js"`, `"./${base}.jsx"`, `'./${base}.js'`, `'./${base}.jsx'`, `"/src/${base}"`];
    const hits = [];
    for (const { file, text } of haystack) {
        if (path.resolve(file) === path.resolve(moduleFile)) continue;
        if (specifiers.some((specifier) => text.includes(specifier))) hits.push(path.relative(ROOT, file));
    }
    return hits;
}

const orphans = [];
const allowlisted = [];
for (const moduleFile of topLevel) {
    const importers = importersFor(moduleFile);
    const name = path.basename(moduleFile);
    if (importers.length > 0) continue;
    if (ALLOWED.has(name)) allowlisted.push({ name, reason: ALLOWED.get(name) });
    else orphans.push({ name, path: path.relative(ROOT, moduleFile) });
}

if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ orphanCount: orphans.length, orphans, allowlisted }, null, 2));
    process.exit(orphans.length ? 1 : 0);
}

console.log(`零引用模块检查：src 顶层 ${topLevel.length} 个模块`);
if (allowlisted.length) {
    console.log(`  白名单 ${allowlisted.length} 个：`);
    for (const item of allowlisted) console.log(`    ${item.name} —— ${item.reason}`);
}
if (orphans.length === 0) {
    console.log("  ✓ 没有悬挂模块");
    process.exit(0);
}
console.error(`  ✗ ${orphans.length} 个模块没有任何引用者：`);
for (const item of orphans) console.error(`    ${item.path}`);
console.error("  要么把它接进界面，要么删掉；确实不需要引用就加进 ALLOWED 并写明理由。");
process.exit(1);
