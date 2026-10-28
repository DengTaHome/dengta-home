# PostgreSQL 16 + pgvector（工作区自包含）

Kiwi × MMTR 融合需要向量列。本机 PostgreSQL 16.4 与 pgvector 0.8.7 已装好并验证。

## 位置

| 用途 | 路径 |
|---|---|
| PostgreSQL bin/lib/share | `D:\GZdeepseek\_tools\pgsql`（备用安装） |
| **当前开发集群的安装** | `C:\Users\24580\AppData\Local\dengta-pgsql` |
| 开发集群数据目录 | `C:\Users\24580\AppData\Local\dengta-pgdata` |
| pgvector 扩展文件 | `lib\vector.dll`、`share\extension\vector*`、`include\server\extension\vector\*` |

## 连接

```
host=127.0.0.1 port=55432 user=postgres（trust 认证）
数据库：dengta_verify（已有）、kiwi（融合用）
```

启动/停止：

```powershell
$pg = "C:\Users\24580\AppData\Local\dengta-pgsql\bin"
& "$pg\pg_ctl.exe" -D "C:\Users\24580\AppData\Local\dengta-pgdata" -o "-p 55432 -c listen_addresses=127.0.0.1" -l "D:\GZdeepseek\_tools\downloads\pg-dev.log" start
& "$pg\pg_ctl.exe" -D "C:\Users\24580\AppData\Local\dengta-pgdata" stop
```

## 已验证（2026-10-28）

```sql
CREATE EXTENSION vector;               -- 0.8.7
CREATE TABLE t (id serial, embedding vector(3));
INSERT INTO t (embedding) VALUES ('[1,2,3]'), ('[4,5,6]');
SELECT embedding <-> '[1,2,3]' FROM t ORDER BY 1;   -- L2 距离：0 / 5.196...
SELECT embedding <=> '[0.1,0.2,0.3,0.4]' ...;       -- 余弦距离：0 / 0.157...
```

## 来源（Windows 非官方构建）

`andreiramani/pgvector_pgsql_windows` 的 release `0.8.7` 资源 `vector.v0.8.7-pg16.zip`，
下载后把 `lib/`、`share/extension/`、`include/server/extension/vector/` 合并进 PostgreSQL 安装目录即可。
GitHub API 走代理会被限流（`rate limit exceeded`），**直连** `api.github.com` 可用。