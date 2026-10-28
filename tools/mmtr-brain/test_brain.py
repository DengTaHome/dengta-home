"""MMTR 脑层移植的不变量测试（用 python 直接跑，无需 pytest）。

只断言「设计承诺」，不做快照：
  - 事实先烂、情绪最后走（三通道速度差）
  - 情绪地板 0.55 让强烈经历永远留下偏向
  - 回血随被想起次数递减
  - 重要记忆不允许被压缩
  - 约定越近越清晰、到期浮出、过期判落空
  - 关系单场上限、越近上限越推不动、张力回落更快
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from brain import (  # noqa: E402
    DEFAULT_CONFIG, MS_DAY, ChannelState, MemoryRecord, RelationState,
    apply_activation, apply_relation_deltas, channel_weight, compute_weights,
    empty_relation_state, evaluate_compression, floor_level_for_importance,
    promise_clarity, promise_info, promise_relation_delta, regress_relation,
    retrieval_score, should_break_promise, should_surface_promise,
)

CFG = DEFAULT_CONFIG
NOW = 1_800_000_000_000.0  # 固定时刻，避免测试依赖真实时钟


def check(name, condition, detail=""):
    if not condition:
        raise AssertionError(f"{name} 失败 {detail}")
    print(f"  ✓ {name}")


# ---------- 三通道衰减 ----------
def test_channel_speeds():
    old = NOW - 30 * MS_DAY
    record = MemoryRecord(
        channels={
            "fact": ChannelState(1.0, old),
            "gist": ChannelState(1.0, old),
            "affect": ChannelState(1.0, old),
        },
        created_at=old,
    )
    weights = compute_weights(record, CFG, NOW)
    check("事实最先淡掉", weights["fact"] < 0.35, weights)
    check("情绪几乎不走", weights["affect"] > 0.85, weights)
    check("三通道有明显速度差", weights["fact"] < weights["gist"] < weights["affect"], weights)


def test_affect_floor():
    # 极老的记忆：affect 仍保留 0.55 的地板（强度为 1 时）
    ancient = NOW - 3650 * MS_DAY
    weight = channel_weight(ChannelState(1.0, ancient), CFG["channels"]["affect"], NOW)
    check("情绪地板 0.55 生效", abs(weight - 0.55) < 0.01, weight)
    # 事实地板 0.02 → 几乎归零
    fact = channel_weight(ChannelState(1.0, ancient), CFG["channels"]["fact"], NOW)
    check("事实地板 0.02 生效", abs(fact - 0.02) < 0.005, fact)


# ---------- 回血 ----------
def test_activation_damping():
    state = ChannelState(0.2, NOW - 10 * MS_DAY)
    first = apply_activation(state, CFG["channels"]["fact"], NOW, recall_count=0)
    second = apply_activation(state, CFG["channels"]["fact"], NOW, recall_count=5)
    check("被想起会回血", first.strength > 0.2, first)
    check("回血随次数递减", second.strength < first.strength, (first, second))


# ---------- 压缩阶梯 ----------
def test_compression():
    check("importance 0.95 → 锁 L0", floor_level_for_importance(0.95, CFG) == 0)
    check("importance 0.2 → 可压到 L3", floor_level_for_importance(0.2, CFG) == 3)

    old = NOW - 90 * MS_DAY
    fading = MemoryRecord(
        channels={name: ChannelState(0.3, old) for name in CFG["channels"]},
        importance=0.4, level=1, floor_level=2, created_at=old,
    )
    decision = evaluate_compression(fading, CFG, NOW, last_compress_at=None)
    check("够旧够淡可以压一级", decision["compress"] is True and decision["to"] == 2, decision)

    locked = MemoryRecord(
        channels={name: ChannelState(0.1, old) for name in CFG["channels"]},
        importance=0.95, level=0, floor_level=0, locked=True, created_at=old,
    )
    check("锁定记忆永不压缩", evaluate_compression(locked, CFG, NOW, None)["compress"] is False)

    important = MemoryRecord(
        channels={name: ChannelState(0.1, old) for name in CFG["channels"]},
        importance=0.7, level=1, floor_level=1, created_at=old,
    )
    check("重要记忆到地板即停", evaluate_compression(important, CFG, NOW, None)["reason"] == "at-floor")


# ---------- 前瞻记忆 ----------
def test_promise():
    far = NOW + 60 * MS_DAY
    near = NOW + 1 * MS_DAY
    due_now = NOW
    check("远期的清晰度停在 0.42", abs(promise_clarity(far, NOW, CFG) - 0.42) < 0.01)
    check("越近越清晰", promise_clarity(near, NOW, CFG) > promise_clarity(far, NOW, CFG))
    check("到期当天清晰度为 1", promise_clarity(due_now, NOW, CFG) == 1.0)
    check("已到期保持 1", promise_clarity(NOW - MS_DAY, NOW, CFG) == 1.0)
    check("到期前一周浮出", should_surface_promise(NOW + 3 * MS_DAY, "pending", NOW, CFG) is True)
    check("还很远不浮出", should_surface_promise(NOW + 40 * MS_DAY, "pending", NOW, CFG) is False)
    check("过期超宽限期判落空",
          should_break_promise(NOW - 5 * MS_DAY, "pending", NOW, CFG) is True)
    check("宽限期内不判落空",
          should_break_promise(NOW - 1 * MS_DAY, "pending", NOW, CFG) is False)
    info = promise_info(NOW + 2 * MS_DAY, "pending", NOW, CFG)
    check("约定信息完整", info["pending"] and not info["overdue"] and info["clarity"] > 0.5, info)
    kept = promise_relation_delta("kept", CFG)
    broken = promise_relation_delta("broken", CFG)
    check("兑现增加信任", kept["trust"] > 0, kept)
    check("落空降低信任且抬高张力", broken["trust"] < 0 and broken["tension"] > 0, broken)





# ---------- 关系 ----------
def test_relation():
    state = empty_relation_state(CFG, NOW)
    base = dict(state.dims)
    result = apply_relation_deltas(state, {"closeness": 0.5}, CFG, NOW)
    check("单场增幅被 0.06 上限截断", result["dims"]["closeness"] - base["closeness"] <= 0.0601,
          result["dims"]["closeness"])
    # 接近上限后同样互动推动更小
    high = RelationState(dims={**base, "closeness": 0.9}, updated_at=NOW)
    high_result = apply_relation_deltas(high, {"closeness": 0.06}, CFG, NOW)
    check("越接近上限越推不动",
          high_result["dims"]["closeness"] - 0.9 < result["dims"]["closeness"] - base["closeness"],
          high_result["dims"]["closeness"])
    # 回归：张力比亲近回落更快
    stirred = RelationState(dims={**base, "tension": 0.4, "closeness": 0.5}, updated_at=NOW - 4 * MS_DAY)
    regressed = regress_relation(stirred, CFG, NOW)
    tension_ratio = (regressed.dims["tension"] - base["tension"]) / (0.4 - base["tension"])
    closeness_ratio = (regressed.dims["closeness"] - base["closeness"]) / (0.5 - base["closeness"])
    check("张力回落比亲近更快", tension_ratio < closeness_ratio, (tension_ratio, closeness_ratio))
    check("张力回落到基线但不超调", regressed.dims["tension"] >= base["tension"] - 1e-6)


# ---------- 检索重排 ----------
def test_retrieval():
    weights = {"gist": 0.8, "fact": 0.4, "affect": 0.9}
    strong = retrieval_score(0.9, weights, importance=0.8)
    inhibited = retrieval_score(0.9, weights, importance=0.8, lateral_penalty=1.0)
    check("横向抑制降低分数", inhibited < strong, (strong, inhibited))
    cold = retrieval_score(0.9, {"gist": 0.0, "fact": 0.0, "affect": 0.0}, importance=0.0, read_only=True)
    check("冷且只读分数更低", cold < strong)


def main():
    tests = [
        test_channel_speeds, test_affect_floor, test_activation_damping,
        test_compression, test_promise, test_relation, test_retrieval,
    ]
    for test in tests:
        print(f"▶ {test.__name__}")
        test()
    print("\n✓ MMTR 脑层移植：全部不变量通过")


if __name__ == "__main__":
    main()
