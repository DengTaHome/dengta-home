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
            const args = ["-sS", "--max-time", "25", ...proxyArgs(), "-H", `Accept: application/vnd.github+json`, "-H", "User-Agent: dengta-repo-watch"];
            if (TOKEN) args.push("-H", `Authorization: Bearer ${TOKEN}`);
            args.push(url);
            const stdout = execFileSync("curl", args, { encoding: "utf8", windowsHide: true });
            if (!stdout.trim()) return { status: 204, payload: null };
            return { status: 200, payload: JSON.parse(stdout) };
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
        if (!info) { errors += 1; rows.push({ repo, error: "not-found" }); continue; }
        const commitResult = await fetchJson(`https://api.github.com/repos/${repo}/commits?per_page=1`);
        commit = Array.isArray(commitResult.payload) ? commitResult.payload[0] : null;
        const releaseResult = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
        release = releaseResult.payload;
    } catch (error) {
        errors += 1;
        rows.push({ repo, error: String(error.message || error) });
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

fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
const noteLines = rows.map((row) => row.note).filter(Boolean);
const lines = [
    "# GitHub 项目追踪（DengTa 生态）",
    "",
    `- 最近检查：${next.updatedAt}`,
    `- 项目数：${config.repos.length}；本次变化：${changed}；错误：${errors}`,
    "",
    "| 项目 | Stars | 最新 commit | 提交时间 | Release | 变化 |",
    "|---|---:|---|---|---|---|",
    ...rows.map((row) => {
        if (row.error) return `| ${row.repo} | — | — | — | — | ⚠️ ${row.error} |`;
        const r = row.record;
        const badge = row.isChanged ? "🆕 有更新" : row.firstSeen ? "首次记录" : "无变化";
        return `| [${row.repo}](https://github.com/${row.repo}) | ${r.stars} | \`${r.commit_sha}\` ${r.commit_message.replace(/\|/g, "\\|")} | ${formatDate(r.commit_date)} | ${r.release_tag || "—"} | ${badge} |`;
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
