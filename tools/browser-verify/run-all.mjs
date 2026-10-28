// 一键实机体检：依次运行所有真机验证脚本，汇总结果。
//
// 每个脚本都是独立的子进程，会自己刷新 token、自己起静态服务器、自己关。
// 体检的目的是看全貌：单项失败不中断后续，但要区分「产品问题」和「环境问题」。
//
// 用法：
//   node tools/browser-verify/run-all.mjs
import { execFileSync } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIR, "..", "..");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173);
const BACKEND = process.env.DENGTA_BACKEND_URL || "https://dengta-home-backend-rkmq.onrender.com";

const CHECKS = [
    { name: "首屏与状态栏（11 项硬指标）", script: "verify-local-build.mjs", blocking: true },
    { name: "触摸目标 · 主界面/状态面板/设置/音乐", script: "verify-touch-targets.mjs", blocking: true },
    { name: "触摸目标 · 投屏接收端/涂鸦画室", script: "verify-touch-extra.mjs", blocking: true },
    { name: "流式渲染（无 undefined、无未捕获异常）", script: "verify-streaming.mjs", blocking: true },
    { name: "私密媒体端到端（头像 / 背景）", script: "verify-media-e2e.mjs", blocking: true },
    { name: "界面稳定性（CLS / 状态栏位移）", script: "verify-stability.mjs", blocking: false },
    { name: "多尺寸安卓适配（360×640 至 800×1280）", script: "verify-layout-matrix.mjs", blocking: true },
    { name: "启动恢复横幅可见性（3 个安卓视口）", script: "verify-startup-recovery.mjs", blocking: true },
    { name: "语音输入链路（长按 / 预热 / 震动 / 收敛）", script: "verify-voice-ui.mjs", blocking: true },
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function portFree() {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => server.close(() => resolve(true)));
        server.listen(PORT, "127.0.0.1");
    });
}

async function waitForPort() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await portFree()) return true;
        await sleep(500);
    }
    return false;
}

function curl(args) {
    try {
        const output = execFileSync("curl.exe", ["-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "60", ...args], { encoding: "utf8" });
        return output.trim();
    } catch {
        return "000";
    }
}

async function preflight() {
    process.stdout.write("▶ 前置检查（后端可达性 + 本地端口）\n");
    let reachable = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const code = curl(["--socks5-hostname", "127.0.0.1:10808", `${BACKEND}/health`]);
        process.stdout.write(`  第 ${attempt} 次探测后端：HTTP ${code}\n`);
        if (code === "200") { reachable = true; break; }
        await sleep(3000);
    }
    if (!reachable) {
        process.stdout.write("\n✗ 后端不可达（可能是代理抖动或 Render 冷启动）。\n");
        process.stdout.write("  这一步失败时不要下「产品有问题」的结论——先恢复环境再跑。\n");
        process.exit(2);
    }
    const free = await waitForPort();
    if (!free) {
        process.stdout.write(`\n✗ 端口 ${PORT} 被占用，无法启动静态服务器。\n`);
        process.exit(2);
    }
    process.stdout.write("  环境就绪\n");
}

function runOnce(script) {
    const startedAt = Date.now();
    try {
        const output = execFileSync(process.execPath, [path.join(DIR, script)], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            timeout: 900_000,
            maxBuffer: 32 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
        return { code: 0, ms: Date.now() - startedAt, lines: String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean) };
    } catch (error) {
        const stdout = String(error?.stdout || "");
        const stderr = String(error?.stderr || "");
        return {
            code: typeof error?.status === "number" ? error.status : 1,
            ms: Date.now() - startedAt,
            lines: `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        };
    }
}

async function runWithRetry(script) {
    const first = runOnce(script);
    if (first.code === 0) return first;
    // 只有「一条断言都没跑到」才重试一次：那通常是 token/网络抖动，不是产品问题。
    const ranAssertions = first.lines.some((line) => /✓|✗/.test(line));
    if (ranAssertions) return first;
    process.stdout.write("  没跑到任何断言，3 秒后重试一次…\n");
    await sleep(3000);
    await waitForPort();
    return runOnce(script);
}

await preflight();

const results = [];
for (const check of CHECKS) {
    process.stdout.write(`\n▶ ${check.name}\n`);
    const result = await runWithRetry(check.script);
    results.push({ ...check, ...result });
    process.stdout.write(`  ${result.code === 0 ? "通过" : "未通过"}（${Math.round(result.ms / 1000)} 秒）\n`);
    for (const line of result.lines.filter((line) => /✓|✗|结论|不通过|全部通过/.test(line)).slice(-8)) {
        process.stdout.write(`    ${line}\n`);
    }
    await waitForPort();
}

const passed = results.filter((result) => result.code === 0);
const blockingFailed = results.filter((result) => result.blocking && result.code !== 0);

process.stdout.write("\n=== 实机体检汇总 ===\n");
for (const result of results) {
    const mark = result.code === 0 ? "✓" : (result.blocking ? "✗" : "△");
    process.stdout.write(`  ${mark} ${result.name}  ${Math.round(result.ms / 1000)}s\n`);
}
process.stdout.write(`\n通过 ${passed.length}/${results.length}\n`);
if (blockingFailed.length) {
    process.stdout.write(`阻断性失败 ${blockingFailed.length} 项：${blockingFailed.map((item) => item.script).join(", ")}\n`);
}
process.stdout.write("（△ 表示非阻断项：只有界面稳定性是观察项，其余任何一项失败都应视为产品问题）\n");
process.exit(blockingFailed.length ? 1 : 0);
