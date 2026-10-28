# kiwi-mem P1 部署包（MMTR 脑层：落库 / 回填 / 每日巩固）

> 目标服务器：用户自建 VPS + Docker Compose，线上地址 **https://kiwi.dengtahome.com**
> 线上版本（2026-10-28 探测）：**Kiwi-Mem v1.6.2**，与本地 P1 基线一致。
> 生产后端 Render 的 `KIWI_MEM_URL` 已指向该域名，所以 kiwi 升级后 DengTa 无需改配置。

## 目录内容

| 文件 | 作用 |
|---|---|
| `deploy-p1.sh` | 服务器上一键部署（备份 → 校验补丁 → 应用 → 重建容器 → 迁移/回填 → 验证 → 打印回滚） |
| `p1-bundle.tar.gz` | 部署载荷：`p1.patch`（database.py/daily_digest.py/compose/env/README）+ `mmtr_brain/` + `docs/MMTR-P1.md` |
| `verify-p1.sql` | 只读验证 SQL（列/表/索引/回填/巩固审计） |
| 本 README | 操作步骤与回滚 |

## 前置条件

- SSH 能登录 kiwi 服务器（`root@119.8.185.219`，端口 22）
- kiwi 目录存在且用 Docker Compose 运行，例如 `/root/kiwi-mem-dengta`
- 服务器可以 `docker compose`、`git`、`curl`；数据库容器名默认 `db`，应用容器名默认 `kiwi-mem`
- **不要在服务器上改过 `database.py`/`daily_digest.py`**；否则 `git apply --check` 会拒绝，需要先合并

## 取包方式（任选，服务器能访问 GitHub 时用 B 最省事）

A. 本机 scp：
```powershell
scp tools\kiwi-deploy\p1-bundle.tar.gz root@119.8.185.219:/tmp/
```
B. 服务器上直接拉仓库里的包（GitHub 被墙时用服务器自己的代理/镜像）：
```bash
git clone --depth 1 https://github.com/DengTaHome/dengta-home.git /tmp/dengta-p1
mkdir -p /tmp/kiwi-p1
tar -xzf /tmp/dengta-p1/tools/kiwi-deploy/p1-bundle.tar.gz -C /tmp/kiwi-p1
```
C. 已有本仓库副本时直接用其中的 `tools/kiwi-deploy/p1-bundle.tar.gz`。

## 部署步骤

### 1. 把部署包放到服务器 /tmp（用上面 A 或 B）

```powershell
# Windows 本机（仓库根目录，只传一个自包含 bundle）
scp tools\kiwi-deploy\p1-bundle.tar.gz root@119.8.185.219:/tmp/
ssh root@119.8.185.219
```

### 2. 服务器上解包并执行

```bash
mkdir -p /tmp/kiwi-p1
tar -xzf /tmp/p1-bundle.tar.gz -C /tmp/kiwi-p1
bash /tmp/kiwi-p1/deploy-p1.sh
# 如果目录不同：KIWI_DIR=/opt/kiwi-mem-dengta bash /tmp/kiwi-p1/deploy-p1.sh
# 容器名不同：KIWI_SERVICE=kiwi KIWI_DB_SERVICE=postgres bash /tmp/kiwi-p1/deploy-p1.sh
```

脚本会依次：

1. 校验 `main.py` 的 `VERSION = 1.6.2`
2. `pg_dump` 备份数据库、`tar` 备份仓库（`/root/kiwi-p1-backup/`）
3. `git apply --check` 后应用补丁，复制 `mmtr_brain/`
4. 在 `.env` 追加 `MMTR_P1_ENABLED=1` / `MMTR_P1_CONSOLIDATE_ENABLED=1`
5. `docker compose up -d --build`，等待 `/` 返回 200
6. 容器内执行 `python -m mmtr_brain.p1 migrate --dsn "$DATABASE_URL"`
7. 执行 `backfill`（只处理 `s_fact IS NULL`，可反复跑）
8. 打印 `consolidate --dry-run` 与 SQL 验证结果
9. 打印回滚命令

### 3. 手工验证（可选的第二条命令）

```bash
cd /root/kiwi-mem-dengta
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < /tmp/kiwi-p1/verify-p1.sql
curl -fsS https://kiwi.dengtahome.com/ ; echo
docker compose exec -T kiwi-mem sh -c 'python -m mmtr_brain.p1 consolidate --dsn "$DATABASE_URL" --dry-run' | head -60
```

> dry-run 不写库；真正生效的是每天 0:05 的 `daily_digest` 之后自动 consolidate。
> 想立即跑一次真实巩固：去掉 `--dry-run`。

### 4. 观察

```bash
docker compose logs --tail=120 kiwi-mem | grep -E 'MMTR|P1|巩固|consolidate|迁移'
```

正常应看到 `MMTR P1 schema 已应用`、`MMTR 巩固：回填 … 压缩 … 承诺 …`。

## 回滚

```bash
cd /root/kiwi-mem-dengta
git checkout -- . && git clean -fd mmtr_brain docs/MMTR-P1.md
docker compose up -d --build
# 如果数据库需要恢复（会覆盖期间写入，执行前确认）：
cat /root/kiwi-p1-backup/kiwi-db-<时间戳>.sql | docker compose exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## 已知边界

- **真实 DSH/QQ 聊天写入新记忆时还没有 s_fact**：P1 的每日 consolidate 会先做增量回填，
  最多延迟一天；P3（chat-turn 拆通道）完成后可实时写入。
- **边衰减未在 P1**（需要给 `memory_edges` 加 `w0/t0/hits` 并按租户隔离），已 descope 到 P2，
  详见 `docs/MMTR-P1.md`。
- 生产 DengTa **后端**（Render）仍是旧代码 0.29.76，仓库里的语音/导入改动还没部署；
  kiwi P1 与它互相独立，先部署 kiwi 不会影响现有聊天（新增列/表对旧字段无破坏）。
- `docker compose up --build` 期间聊天会短暂不可用（分钟级），建议低峰执行。
