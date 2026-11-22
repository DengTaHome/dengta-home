#!/usr/bin/env python3
"""Refresh the complete DengTa workspace snapshot and push it to CNB.

This is the CNB half of the mandatory sync process. It intentionally excludes
credentials, build output and platform-private state. CSVs/JSON are not
special-cased: the snapshot is plain source + docs + tools.

Usage:
    python sync-cnb-snapshot.py
    python sync-cnb-snapshot.py --no-push
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "_incoming" / "cnb-workspace-20261122"
SOURCES = {
    "frontend": ROOT / "_refs" / "frontend-gh",
    "frontend-ios": ROOT / "_worktrees" / "ios-import-75ad3da",
    "backend": ROOT / "_refs" / "backend-prod",
    "docs": ROOT / "dengta-home" / "docs",
    "tools": ROOT / "dengta-home" / "tools",
}
CNB_URL = "https://cnb.cool/DengTaArchive2026/dengta-workspace"
TOKEN_FILE = ROOT / "_credentials" / "cnb-newaccount-all-token-20261122.txt"
GIT = r"D:\GZdeepseek\_tools\git\cmd\git.exe" if (ROOT / "_tools" / "git" / "cmd" / "git.exe").exists() else "git"
SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "Pods", "DerivedData",
    "_audit", "artifacts", ".gradle", ".next", "coverage", ".expo",
    "xcuserdata", "*.xcworkspace/xcuserdata",
}
SKIP_SUFFIXES = {
    ".keystore", ".jks", ".p12", ".pfx", ".pem", ".mobileprovision",
    ".provisionprofile", ".xcarchive", ".apk", ".ipa", ".aab",
}
SKIP_NAMES = {
    ".env", ".env.local", ".env.development", ".env.production",
    ".env.test", ".wxb", "local.properties",
}


def ignored(rel: Path) -> bool:
    parts = set(rel.parts)
    if parts & SKIP_DIRS:
        return True
    name = rel.name
    if name in SKIP_NAMES:
        return True
    if name.startswith(".env.") and name != ".env.example":
        return True
    if rel.suffix.lower() in SKIP_SUFFIXES:
        return True
    return False


def copy_tree(src: Path, dst: Path) -> tuple[int, int]:
    if not src.exists():
        raise SystemExit(f"missing source: {src}")
    if dst.exists():
        shutil.rmtree(dst, ignore_errors=True)
    dst.mkdir(parents=True, exist_ok=True)
    files = 0
    total = 0
    for dp, dns, fns in os.walk(src):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS)
        cur = Path(dp)
        for fn in sorted(fns):
            full = cur / fn
            rel = full.relative_to(src)
            if ignored(rel) or full.is_symlink() or not full.is_file():
                continue
            out = dst / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(full, out)
            files += 1
            total += out.stat().st_size
    return files, total


def git_output(repo: Path, *args: str) -> str:
    p = subprocess.run(
        [GIT, "-C", str(repo), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if p.returncode != 0:
        raise RuntimeError((p.stdout + p.stderr).strip())
    return p.stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-push", action="store_true")
    args = ap.parse_args()

    if not TARGET.exists():
        raise SystemExit(f"missing CNB worktree: {TARGET}")

    # Keep the target's .git and the two hand-written root docs.
    for name in ("frontend", "frontend-ios", "backend", "docs", "tools"):
        p = TARGET / name
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)

    counts = {}
    source_commits = {}
    for name, src in SOURCES.items():
        files, size = copy_tree(src, TARGET / name)
        counts[name] = {"files": files, "bytes": size, "source": str(src)}
        try:
            source_commits[name] = git_output(src, "rev-parse", "HEAD")
        except Exception:
            source_commits[name] = None

    manifest_path = TARGET / "SYNC-MANIFEST.json"
    old_manifest = {}
    if manifest_path.exists():
        try:
            old_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            old_manifest = {}
    manifest = {
        "generated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "source_roots": {k: str(v) for k, v in SOURCES.items()},
        "source_commits": source_commits,
        "counts": counts,
        "files": sum(v["files"] for v in counts.values()),
        "bytes": sum(v["bytes"] for v in counts.values()),
        "excluded": sorted(SKIP_DIRS | SKIP_NAMES)
        + ["*.env.* except .env.example", "*.apk", "*.ipa", "*.aab", "*.keystore"],
        "cnb_repo": CNB_URL,
    }
    # Keep the old manifest when sources did not change, so repeated runs do
    # not create timestamp-only commits.
    if (
        old_manifest.get("source_commits") == manifest["source_commits"]
        and old_manifest.get("counts") == manifest["counts"]
        and old_manifest.get("files") == manifest["files"]
        and old_manifest.get("bytes") == manifest["bytes"]
    ):
        manifest = old_manifest
    else:
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    # Commit any change in the CNB snapshot worktree.
    subprocess.run([GIT, "-C", str(TARGET), "add", "-A"], check=True)
    status = subprocess.run(
        [GIT, "-C", str(TARGET), "status", "--porcelain"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stdout.strip()
    if status:
        msg = f"Sync workspace snapshot {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        subprocess.run([GIT, "-C", str(TARGET), "commit", "-m", msg], check=True)
    commit = git_output(TARGET, "rev-parse", "HEAD")
    print(f"snapshot files={manifest['files']} bytes={manifest['bytes']} commit={commit}")

    if args.no_push:
        return 0

    token = os.environ.get("CNB_TOKEN", "").strip()
    if not token and TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        raise SystemExit("CNB_TOKEN missing")

    # Use a one-command header so the token is never written to .git/config.
    import base64
    auth = base64.b64encode(f"cnb:{token}".encode()).decode()
    cmd = [
        GIT, "-C", str(TARGET),
        "-c", "http.proxy=", "-c", "https.proxy=",
        "-c", f"http.extraheader=Authorization: Basic {auth}",
        "push", CNB_URL, "HEAD:main",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    printable = (p.stdout + p.stderr).replace(token, "***")
    print(printable[-1200:])
    if p.returncode != 0:
        raise SystemExit(p.returncode)
    print(f"pushed CNB {CNB_URL} main={commit}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
