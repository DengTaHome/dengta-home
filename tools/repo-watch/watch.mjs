#!/usr/bin/env node
/**
 * Track updates of the GitHub projects DengTa integrates with.
 *
 * - Reads repo list from tools/repo-watch/repos.json
 * - Uses GITHUB_TOKEN or the local credentials file (never prints the token)
 * - Compares latest commit/release with docs/REPO-WATCH-STATE.json
 * - Rewrites docs/REPO-WATCH.md and prints a small JSON summary
 *
 * Run it daily (Windows Task Scheduler / cron) or by asking the agent.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const REPOS_PATH = process.env.REPO_WATCH_REPOS || path.join(ROOT, "tools", "repo-watch", "repos.json");
const STATE_PATH = process.env.REPO_WATCH_STATE || path.join(ROOT, "docs", "REPO-WATCH-STATE.json");
const MARKDOWN_PATH = process.env.REPO_WATCH_MARKDOWN || path.join(ROOT, "docs", "REPO-WATCH.md");
const CREDENTIALS_PATH = process.env.DENGTA_CREDENTIALS || path.join("D:\\GZdeepseek", "_credentials", "dengta-credentials.json");

function token() {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
    try {
        const cred = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
        return String(cred?.github?.pat || "").trim();
    } catch {
        return "";
    }
}
const TOKEN = token();

function proxyArgs() {
    const proxy = process.env.GITHUB_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
    return proxy ? ["--proxy", proxy, "--ssl-no-revoke"] : ["--noproxy", "*"];
}

async function fetchJson(url) {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "dengta-repo-watch" };
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
        if (response.status === 404) return { status: 404, payload: null };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { status: response.status, payload: await response.json() };
    } catch (error) {
        // Fall back to curl when Node cannot reach GitHub directly (common on CN networks).
        try {
            const args = ["-sS", "--max-time", "25", ...proxyArgs(), "-H", `Accept: application/vnd.github+json`, "-H", "User-Agent: dengta-repo-watch", "-w", "\n__HTTP_STATUS__%{http_code}"];
            if (TOKEN) args.push("-H", `Authorization: Bearer ${TOKEN}`);
            args.push(url);
            const stdout = execFileSync("curl", args, { encoding: "utf8", windowsHide: true });
            const marker = "__HTTP_STATUS__";
            const markerIndex = stdout.lastIndexOf(marker);
            if (markerIndex < 0) throw new Error("curl response missing HTTP status");
            const status = Number(stdout.slice(markerIndex + marker.length).trim());
            const body = stdout.slice(0, markerIndex).trim();
            if (status === 404) return { status: 404, payload: null };
            if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
            return { status, payload: body ? JSON.parse(body) : null };
        } catch {
            throw error;
        }
    }
}

function shortSha(value) {
    return String(value || "").slice(0, 8);
}
function formatDate(value) {
    if (!value) return "—";
    return String(value).replace("T", " ").replace("Z", " UTC").slice(0, 19);
}

const config = JSON.parse(fs.readFileSync(REPOS_PATH, "utf8"));
const previous = (() => {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { updatedAt: null, repos: {} }; }
})();
const next = { updatedAt: new Date().toISOString(), repos: {} };
const rows = [];
let changed = 0;
let errors = 0;

for (const repo of config.repos) {
    let info;
    let commit;
    let release;
    try {
        info = (await fetchJson(`https://api.github.com/repos/${repo}`)).payload;
        if (!info) {
            errors += 1;
            if (previous.repos?.[repo]) next.repos[repo] = previous.repos[repo];
            rows.push({ repo, error: "not-found", url: `https://github.com/${repo}` });
            continue;
        }
        const commitResult = await fetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`);
        commit = Array.isArray(commitResult.payload) ? commitResult.payload[0] : null;
        const releaseResult = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
        release = releaseResult.payload;
    } catch (error) {
        errors += 1;
        if (previous.repos?.[repo]) next.repos[repo] = previous.repos[repo];
        rows.push({ repo, error: String(error.message || error), url: `https://github.com/${repo}` });
        continue;
    }
    const record = {
        full_name: info.full_name,
        stars: info.stargazers_count,
        pushed_at: info.pushed_at,
        commit_sha: shortSha(commit?.sha),
        commit_message: String(commit?.commit?.message || "").split("\n")[0].slice(0, 120),
        commit_date: commit?.commit?.committer?.date || null,
        release_tag: release?.tag_name || "",
        release_date: release?.published_at || null,
        checkedAt: next.updatedAt,
    };
    const before = previous.repos?.[repo] || null;
    const isChanged = !before
        ? false
        : before.commit_sha !== record.commit_sha || before.release_tag !== record.release_tag;
    if (isChanged) changed += 1;
    next.repos[repo] = record;
    rows.push({ repo, record, isChanged, firstSeen: !before, note: config.notes?.[repo] || "" });
    console.log(JSON.stringify({ repo, commit: record.commit_sha, release: record.release_tag, changed: isChanged, firstSeen: !before }));
}


// CNB 镜像仓库：只做 HEAD 追踪（GitHub Actions 额度恢复后再同步）。
for (const repo of (config.cnbRepos || [])) {
    try {
        const gitBin = process.env.GIT_BIN || (fs.existsSync("D:\\GZdeepseek\\_tools\\git\\cmd\\git.exe") ? "D:\\GZdeepseek\\_tools\\git\\cmd\\git.exe" : "git");
        const args = ["ls-remote", `https://cnb.cool/${repo}.git`, "refs/heads/frontend-main"];
        const proxy = process.env.CNB_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
        if (proxy) args.unshift("-c", `http.proxy=${proxy}`, "-c", `https.proxy=${proxy}`);
        const output = execFileSync(gitBin, args, { encoding: "utf8", windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        const sha = String(output).trim().split(/\s+/)[0] || "";
        if (!sha) throw new Error("ls-remote returned no frontend-main commit");
        const record = {
            full_name: repo,
            host: "cnb.cool",
            stars: null,
            pushed_at: null,
            commit_sha: shortSha(sha),
            commit_message: "CNB frontend-main HEAD",
            commit_date: null,
            release_tag: "",
            release_date: null,
            checkedAt: next.updatedAt,
        };
        const before = previous.repos?.[repo] || null;
        const isChanged = before ? before.commit_sha !== record.commit_sha : false;
        if (isChanged) changed += 1;
        next.repos[repo] = record;
        rows.push({ repo, record, isChanged, firstSeen: !before, note: config.notes?.[`cnb:${repo}`] || "", url: `https://cnb.cool/${repo}` });
        console.log(JSON.stringify({ repo, host: "cnb.cool", commit: record.commit_sha, changed: isChanged, firstSeen: !before }));
    } catch (error) {
        errors += 1;
        rows.push({ repo, error: String(error.message || error), url: `https://cnb.cool/${repo}` });
    }
}

fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
const noteLines = rows.map((row) => row.note).filter(Boolean);
const lines = [
    "# 项目追踪（GitHub + CNB，DengTa 生态）",
    "",
    `- 最近检查：${next.updatedAt}`,
    `- 项目数：${config.repos.length + (config.cnbRepos || []).length}（GitHub ${config.repos.length} + CNB ${(config.cnbRepos || []).length}）；本次变化：${changed}；错误：${errors}`,
    "",
    "| 项目 | Stars | 最新 commit | 提交时间 | Release | 变化 |",
    "|---|---:|---|---|---|---|",
    ...rows.map((row) => {
        if (row.error) return `| [${row.repo}](${row.url}) | — | — | — | — | ⚠️ ${row.error} |`;
        const r = row.record;
        const badge = row.isChanged ? "🆕 有更新" : row.firstSeen ? "首次记录" : "无变化";
        return `| [${row.repo}](${row.url || `https://github.com/${row.repo}`}) | ${r.stars ?? "—"} | \`${r.commit_sha}\` ${r.commit_message.replace(/\|/g, "\\|")} | ${formatDate(r.commit_date)} | ${r.release_tag || "—"} | ${badge} |`;
    }),
    "",
    "## 已记录的项目说明",
    "",
    ...noteLines.map((line) => `- ${line}`),
    "",
    "> 由 `tools/repo-watch/watch.mjs` 生成；状态文件 `docs/REPO-WATCH-STATE.json`。",
    ""
];
fs.writeFileSync(MARKDOWN_PATH, lines.join("\n"));
console.log(JSON.stringify({ ok: true, changed, errors, markdown: MARKDOWN_PATH, state: STATE_PATH }));
