#!/usr/bin/env bash
# kiwi-mem MMTR P1 部署脚本（在 kiwi 服务器上以 root 执行）
#
# 用法：
#   tar -xzf p1-bundle.tar.gz -C /tmp/kiwi-p1
#   sudo bash /tmp/kiwi-p1/deploy-p1.sh
#   或指定目录：IKIWI_DIR=/opt/kiwi-mem-dengta bash /tmp/kiwi-p1/deploy-p1.sh
#
# 安全策略：
#   - 要求服务器代码与 P1 基线版本一致（main.py VERSION = 1.6.2）
#   - 先 pg_dump 备份数据库、再备份仓库 HEAD
#   - git apply --check 不通过就中止（版本/代码冲突不会硬套）
#   - 全程可回滚：脚本结束会打印回滚命令
set -euo pipefail

KIWI_DIR="${KIWI_DIR:-/root/kiwi-mem-dengta}"
BACKUP_DIR="${BACKUP_DIR:-/root/kiwi-p1-backup}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
    COMPOSE="docker-compose"
fi
SERVICE="${KIWI_SERVICE:-kiwi-mem}"
DB_SERVICE="${KIWI_DB_SERVICE:-db}"

log() { printf '\033[1;32m[kiwi-p1]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[kiwi-p1] 失败：\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "请用 root（或 sudo）执行"
[ -d "$KIWI_DIR" ] || fail "找不到 kiwi 目录：$KIWI_DIR（可用 KIWI_DIR=... 指定）"
cd "$KIWI_DIR"
[ -f docker-compose.yml ] || fail "目录里没有 docker-compose.yml，确认这是 kiwi-mem 部署目录"
command -v git >/dev/null || fail "服务器没有 git"
command -v python3 >/dev/null || fail "服务器没有 python3（仅用于校验版本文本）"

VERSION="$(python3 - <<'PY'
import re
text = open("main.py", encoding="utf-8").read()
m = re.search(r'^VERSION\s*=\s*"([^"]+)"', text, re.M)
print(m.group(1) if m else "unknown")
PY
)"
log "kiwi 版本：$VERSION"
[ "$VERSION" = "1.6.2" ] || fail "P1 基线是 1.6.2，当前是 $VERSION；请先在开发环境重做补丁后再部署"

if [ -n "$(git status --porcelain)" ] && [ "${FORCE:-0}" != "1" ]; then
    git status --porcelain | head -20
    fail "工作区有未提交改动；请先 git stash/提交，或设 FORCE=1 强制继续（会先备份）"
fi

mkdir -p "$BACKUP_DIR"
log "备份数据库到 $BACKUP_DIR/kiwi-db-$STAMP.sql"
$COMPOSE exec -T "$DB_SERVICE" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_DIR/kiwi-db-$STAMP.sql" \
    || fail "pg_dump 失败（确认 $DB_SERVICE 容器在运行）"
[ -s "$BACKUP_DIR/kiwi-db-$STAMP.sql" ] || fail "数据库备份为空，已中止"
log "备份仓库 HEAD 到 $BACKUP_DIR/repo-$STAMP.tar.gz"
tar -czf "$BACKUP_DIR/repo-$STAMP.tar.gz" --exclude='.git' --exclude='__pycache__' .
git rev-parse HEAD > "$BACKUP_DIR/repo-head-$STAMP.txt"

log "校验补丁……"
git apply --check --verbose "$BUNDLE_DIR/p1.patch" || fail "补丁与当前代码不匹配（线上仓库可能被改过），已中止，未改任何文件"
git apply "$BUNDLE_DIR/p1.patch"
cp -a "$BUNDLE_DIR/mmtr_brain" "$KIWI_DIR/mmtr_brain"
mkdir -p "$KIWI_DIR/docs"
cp -a "$BUNDLE_DIR/docs/MMTR-P1.md" "$KIWI_DIR/docs/MMTR-P1.md"
find "$KIWI_DIR/mmtr_brain" -name '__pycache__' -type d -prune -exec rm -rf {} +

if ! grep -q '^MMTR_P1_ENABLED=' .env 2>/dev/null; then
    cat >> .env <<'EOF'

# ---- MMTR × kiwi P1（脑层落库/每日巩固）----
MMTR_P1_ENABLED=1
MMTR_P1_CONSOLIDATE_ENABLED=1
EOF
    log "已在 .env 写入 MMTR_P1_* 开关"
else
    log ".env 已存在 MMTR_P1_*，保持不变"
fi

log "重建并重启容器（docker compose up -d --build）……"
$COMPOSE up -d --build

log "等待服务就绪（最多 120s）……"
for i in $(seq 1 60); do
    if curl -fsS --max-time 3 http://127.0.0.1:8080/ >/dev/null 2>&1; then
        log "服务已就绪"
        break
    fi
    [ "$i" = "60" ] && fail "服务 120s 内未就绪，请查看：$COMPOSE logs --tail=120 $SERVICE"
    sleep 2
done

log "执行 P1 迁移（public + 所有租户 schema）……"
$COMPOSE exec -T "$SERVICE" sh -c 'python -m mmtr_brain.p1 migrate --dsn "$DATABASE_URL"'

log "回填旧记忆热度（只处理 s_fact IS NULL，可反复执行）……"
$COMPOSE exec -T "$SERVICE" sh -c 'python -m mmtr_brain.p1 backfill --dsn "$DATABASE_URL"' || log "回填有告警（不影响启动，可稍后重跑）"

log "验证：P1 列/表/索引 + 巩固 dry-run"
$COMPOSE exec -T "$DB_SERVICE" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
\pset pager off
SELECT current_database();
SELECT table_schema, count(*) AS p1_columns
FROM information_schema.columns
WHERE table_name = 'memories'
  AND column_name IN ('s_fact','s_gist','s_affect','t_fact','t_gist','t_affect',
                      'level','floor_level','promise_state','due_at','theme_key',
                      'recall_count','last_compress_at','promise_surfaced_at','last_consolidated_at')
GROUP BY table_schema ORDER BY table_schema;
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_name IN ('relation_state','mmtr_activations','mmtr_consolidate_runs','mmtr_p1_meta')
ORDER BY table_schema, table_name;
SELECT count(*) AS backfilled_rows FROM memories WHERE s_fact IS NOT NULL;
SQL

$COMPOSE exec -T "$SERVICE" sh -c 'python -m mmtr_brain.p1 consolidate --dsn "$DATABASE_URL" --dry-run' \
    | head -40 || true

cat <<EOF

============================================================
P1 部署完成（数据库备份：$BACKUP_DIR/kiwi-db-$STAMP.sql）

回滚（如需）：
  cd $KIWI_DIR
  git checkout -- . && git clean -fd mmtr_brain docs/MMTR-P1.md
  $COMPOSE up -d --build
  # 如数据库损坏：cat $BACKUP_DIR/kiwi-db-$STAMP.sql | $COMPOSE exec -T $DB_SERVICE \\
  #   sh -c 'psql -U "\$POSTGRES_USER" -d "\$POSTGRES_DB"'

之后每天 0:05 的 daily_digest 会自动执行 consolidate；也可以手动：
  $COMPOSE exec -T $SERVICE sh -c 'python -m mmtr_brain.p1 consolidate --dsn "\$DATABASE_URL"'
============================================================
EOF
