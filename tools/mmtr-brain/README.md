# MMTR × kiwi 脑层（DengTa 仓库镜像）

这里是 `D:\GZdeepseek\_refs\kiwi-mem-dengta\mmtr_brain\` 与接入改动的**可 git 追踪副本**，
用于备份与审阅；正式接入点在 kiwi-mem fork（`database.py` / `daily_digest.py` / `mmtr_brain/`）。
镜像里的 `*.py` 依赖包内相对导入，**请回 fork 运行**；`fork-integration.patch` 是
database.py / daily_digest.py / docker-compose / .env.example 的完整 diff，可套到部署分支。

| 文件 | 说明 |
|---|---|
| `brain.py` | P0：MMTR 纯公式移植（三通道/压缩/承诺/关系/检索重排） |
| `p1.py` | P1：Postgres 迁移、旧热回填、每日 consolidate（每 schema 事务 + advisory lock） |
| `test_brain.py` | P0 不变量测试（29 条 check） |
| `test_p1_pg.py` | P1 主链路测试（migrate/backfill/consolidate） |
| `test_p1_guards_pg.py` | P1 守卫测试（禁用/老租户/update_memory/并发/饥饿/dry-run/边界） |
| `p1_backfill_sample.json` | 旧 heat vs 新三通道权重抽样产物 |
| `fork-integration.patch` | kiwi fork 接入点完整 diff |
| `MMTR-P1.md` | 数据模型、回填公式、并发与性能约束、验证命令 |

在 fork 里运行（需要本机 PG16 + pgvector，见 `tools/pgsql/README.md`）：

```powershell
$py = "D:\GZdeepseek\_tools\python312\python.exe"
$env:PYTHONUTF8 = "1"
Set-Location D:\GZdeepseek\_refs\kiwi-mem-dengta
& $py mmtr_brain\test_brain.py
& $py -m mmtr_brain.test_p1_pg
& $py -m mmtr_brain.test_p1_guards_pg
```

设计边界：只搬 MMTR 的记忆物理量（三通道、压缩阶梯、关系向量、前瞻记忆）；
P1 只做落库/回填/每日巩固，**检索仍走旧 heat**，`weights/promise` 进 `/memory/recall`
是 P2。边衰减因需要租户级 edge 表结构，显式 descope 到 P2。