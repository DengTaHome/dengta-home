"""MMTR 脑层核心公式的 Python 移植（供 kiwi-mem 融合使用）。

来源：https://github.com/CRTNET8866/MMTR（零依赖、node:sqlite、MIT）
本文件只移植**纯算法**，不涉及数据库与网络：
  - 三通道衰减（fact/gist/affect）+ 地板
  - 复习回血（增益随次数递减）
  - 压缩阶梯（importance → floorLevel → 逐级压缩判定）
  - 前瞻记忆（清晰度反向曲线、落地/落空判定、关系后果）
  - 关系六维向量（上限、速率衰减、回归半衰期、张力单独更快）

移植原则：公式与默认参数逐项对应 MMTR src/decay.ts、src/promise.ts、
src/relation.ts、src/config.ts 的 DEFAULT_CONFIG；不改语义，便于 kiwi-mem
直接替换掉现在「单一 heat」的衰减计算。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Optional

MS_DAY = 86_400_000.0  # 毫秒；与 MMTR 保持同一时间单位

# ---------------------------------------------------------------------------
# 默认配置（逐项对应 MMTR src/config.ts DEFAULT_CONFIG）
# ---------------------------------------------------------------------------
DEFAULT_CONFIG: Dict = {
    "channels": {
        "fact":   {"tau_days": 4,   "power": 0.9,  "floor_factor": 0.02, "gain": 0.55},
        "gist":   {"tau_days": 12,  "power": 0.75, "floor_factor": 0.12, "gain": 0.40},
        "affect": {"tau_days": 180, "power": 0.28, "floor_factor": 0.55, "gain": 0.22},
    },
    "levels": {
        "floor_thresholds": {"l0": 0.9, "l1": 0.62, "l2": 0.38},
        "compress_thresholds": {"0": 0.42, "1": 0.18, "2": 0.07},
        "min_interval_days": {"0": 1, "1": 7, "2": 30},
        "per_step_strength_factor": 0.9,
    },
    "promise": {
        "horizon_days": 45,
        "clarity_floor": 0.42,
        "clarity_curve": 1.25,
        "surface_lookahead_days": 7,
        "grace_days": 3,
        "default_days": 30,
        "max_horizon_days": 400,
        "kept_closeness": 0.03,
        "kept_trust": 0.02,
        "kept_warmth": 0.025,
        "kept_tension_relief": 0.02,
        "broken_trust": 0.012,
        "broken_warmth": 0.01,
        "broken_tension": 0.018,
    },
    "relation": {
        "dims": {
            "closeness": 0.28, "trust": 0.30, "playfulness": 0.35,
            "warmth": 0.32, "tension": 0.10, "familiarity": 0.25,
        },
        "ceiling": 0.95,
        "max_delta_per_session": 0.06,
        "rate_limit_factor": 0.55,
        "regression_half_life_days": 21,
        "tension_half_life_days": 4,
    },
    "retrieval": {
        "weights": {
            "similarity": 0.42, "gist": 0.18, "fact": 0.08,
            "affect": 0.14, "importance": 0.10, "calendar": 0.12,
            "theme": 0.08,
        },
        "lateral_inhibition": 0.18,
        "read_only_penalty": 0.04,
        "redundant_penalty": 0.25,
        "mmr_lambda": 0.72,
    },
}

RELATION_DIMS = ("closeness", "trust", "playfulness", "warmth", "tension", "familiarity")
MAX_LEVEL = 3


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def clamp01(value: float) -> float:
    return clamp(value, 0.0, 1.0)


def power_decay(age_in_tau: float, power: float) -> float:
    """(1 + age/tau) ^ -power，MMTR 的衰减骨架。"""
    return (1.0 + max(0.0, age_in_tau)) ** (-power)


# ---------------------------------------------------------------------------
# 三通道衰减
# ---------------------------------------------------------------------------
@dataclass
class ChannelState:
    strength: float
    updated_at: float  # 毫秒时间戳


@dataclass
class MemoryRecord:
    channels: Dict[str, ChannelState]
    importance: float = 0.5
    level: int = 0
    floor_level: int = 3
    locked: bool = False
    read_only: bool = False
    promise_state: str = "none"  # none | pending | kept | broken
    due_at: Optional[float] = None
    created_at: float = 0.0


def channel_weight(state: ChannelState, cfg: Dict, now: float) -> float:
    age_days = max(0.0, now - state.updated_at) / MS_DAY
    age_in_tau = age_days / max(0.0001, cfg["tau_days"])
    decay = power_decay(age_in_tau, cfg["power"])
    factor = max(cfg["floor_factor"], decay)
    return clamp01(state.strength * factor)


def compute_weights(record: MemoryRecord, config: Dict, now: float) -> Dict[str, float]:
    channels = config["channels"]
    raw = {name: channel_weight(record.channels[name], channels[name], now) for name in channels}
    cfg = config["promise"]
    if record.promise_state == "pending" and record.due_at is not None:
        clarity = promise_clarity(record.due_at, now, config)
        return {
            "fact": max(raw["fact"], 0.2 + 0.45 * clarity),
            "gist": max(raw["gist"], 0.42 + 0.58 * clarity),
            "affect": max(raw["affect"], 0.5 + 0.5 * clarity),
        }
    if record.promise_state in ("kept", "broken"):
        return {
            "fact": raw["fact"],
            "gist": max(raw["gist"], 0.4),
            "affect": max(raw["affect"], 0.45),
        }
    return raw


def apply_activation(state: ChannelState, cfg: Dict, now: float, recall_count: int,
                     strength_scale: float = 1.0) -> ChannelState:
    """复习回血：增益随被想起次数递减（防检索自增强的第一道闸）。"""
    current = channel_weight(state, cfg, now)
    damping = 1.0 / (1.0 + max(0, recall_count) * 0.6)
    boost = cfg["gain"] * (1.0 - current) * damping * strength_scale
    return ChannelState(strength=clamp01(max(current, current + boost)), updated_at=now)


# ---------------------------------------------------------------------------
# 压缩阶梯
# ---------------------------------------------------------------------------
def floor_level_for_importance(importance: float, config: Dict) -> int:
    thresholds = config["levels"]["floor_thresholds"]
    if importance >= thresholds["l0"]:
        return 0
    if importance >= thresholds["l1"]:
        return 1
    if importance >= thresholds["l2"]:
        return 2
    return 3


def evaluate_compression(record: MemoryRecord, config: Dict, now: float,
                         last_compress_at: Optional[float]) -> Dict:
    """是否该往下压一级。locked / 到地板 / fact 仍亮 / 距上次太近 → 不压。"""
    from_level = record.level
    fact_weight = channel_weight(record.channels["fact"], config["channels"]["fact"], now)
    base = {"compress": False, "from": from_level, "to": from_level,
            "reason": "", "fact_weight": fact_weight}
    if record.locked:
        return {**base, "reason": "locked"}
    if from_level >= MAX_LEVEL:
        return {**base, "reason": "bottom"}
    if from_level >= record.floor_level:
        return {**base, "reason": "at-floor"}
    key = str(from_level)
    if fact_weight >= config["levels"]["compress_thresholds"][key]:
        return {**base, "reason": "fact-alive"}
    min_interval = config["levels"]["min_interval_days"][key]
    if last_compress_at is not None and (now - last_compress_at) / MS_DAY < min_interval:
        return {**base, "reason": "too-soon"}
    return {"compress": True, "from": from_level, "to": from_level + 1,
            "reason": "below-threshold", "fact_weight": fact_weight}


# ---------------------------------------------------------------------------
# 前瞻记忆
# ---------------------------------------------------------------------------
def days_between(start: float, end: float) -> float:
    return (end - start) / MS_DAY


def promise_clarity(due_at: float, now: float, config: Dict) -> float:
    cfg = config["promise"]
    days = days_between(now, due_at)
    if days <= 0:
        return 1.0
    horizon = max(1.0, cfg["horizon_days"])
    if days >= horizon:
        return clamp01(cfg["clarity_floor"])
    t = 1.0 - days / horizon
    return round(clamp01(cfg["clarity_floor"] + (1 - clamp01(cfg["clarity_floor"])) * t ** cfg["clarity_curve"]), 4)


def promise_info(due_at: float, state: str, now: float, config: Dict) -> Dict:
    cfg = config["promise"]
    days_until_due = round(days_between(now, due_at), 2)
    clarity = (promise_clarity(due_at, now, config) if state == "pending"
               else 0.2 if state == "kept" else 0.35)
    urgency = 0.0
    if state == "pending":
        urgency = 1.0 if days_until_due <= 0 else clamp01(1.0 - days_until_due / max(1.0, cfg["horizon_days"]))
    return {
        "pending": state == "pending",
        "overdue": state == "pending" and days_until_due < 0,
        "days_until_due": days_until_due,
        "clarity": clarity,
        "urgency": urgency,
    }


def should_break_promise(due_at: float, state: str, now: float, config: Dict) -> bool:
    if state != "pending":
        return False
    return now > due_at + max(0.0, config["promise"]["grace_days"]) * MS_DAY


def should_surface_promise(due_at: float, state: str, now: float, config: Dict) -> bool:
    if state != "pending":
        return False
    cfg = config["promise"]
    days = days_between(now, due_at)
    if days > cfg["surface_lookahead_days"]:
        return False
    if days < -max(0.0, cfg["grace_days"]):
        return False
    return True


def promise_relation_delta(outcome: str, config: Dict) -> Dict[str, float]:
    cfg = config["promise"]
    if outcome == "kept":
        return {"closeness": cfg["kept_closeness"], "trust": cfg["kept_trust"],
                "warmth": cfg["kept_warmth"], "tension": -cfg["kept_tension_relief"]}
    return {"trust": -cfg["broken_trust"], "warmth": -cfg["broken_warmth"],
            "tension": cfg["broken_tension"]}


# ---------------------------------------------------------------------------
# 关系向量
# ---------------------------------------------------------------------------
@dataclass
class RelationState:
    dims: Dict[str, float]
    updated_at: float


def baseline_dims(config: Dict) -> Dict[str, float]:
    return {dim: float(config["relation"]["dims"][dim]) for dim in RELATION_DIMS}


def empty_relation_state(config: Dict, now: float) -> RelationState:
    return RelationState(dims=baseline_dims(config), updated_at=now)


def regress_relation(state: RelationState, config: Dict, now: float) -> RelationState:
    """向基线缓慢回落；tension 用更短半衰期（人会和解）。"""
    cfg = config["relation"]
    dt_days = max(0.0, now - state.updated_at) / MS_DAY
    if dt_days < 0.02:
        return state
    base = baseline_dims(config)
    dims = {}
    for dim in RELATION_DIMS:
        half_life = cfg["tension_half_life_days"] if dim == "tension" else cfg["regression_half_life_days"]
        half_life = max(0.5 if dim == "tension" else 1.0, half_life)
        keep = 0.5 ** (dt_days / half_life)
        dims[dim] = round(clamp01(base[dim] + (state.dims[dim] - base[dim]) * keep), 4)
    return RelationState(dims=dims, updated_at=now)


def apply_relation_deltas(state: RelationState, delta: Optional[Dict[str, float]],
                          config: Dict, now: float) -> Dict:
    """施加关系增量：单场上限 + 越接近上限越推不动；正增量还受余量压缩。"""
    regressed = regress_relation(state, config, now)
    dims = dict(regressed.dims)
    if not delta:
        return {"dims": dims, "applied": None}
    cfg = config["relation"]
    base = baseline_dims(config)
    ceiling = cfg["ceiling"]
    applied: Dict[str, float] = {}
    for dim in RELATION_DIMS:
        raw = delta.get(dim)
        if not isinstance(raw, (int, float)) or abs(raw) < 1e-6:
            continue
        capped = clamp(raw, -cfg["max_delta_per_session"], cfg["max_delta_per_session"])
        span = max(0.0001, ceiling - base[dim])
        room = clamp01((ceiling - dims[dim]) / span)
        squeeze = 1.0 - cfg["rate_limit_factor"] * clamp01((dims[dim] - base[dim]) / span)
        effective = capped * (squeeze if capped > 0 else 1.0) * (max(0.15, room) if capped > 0 else 1.0)
        nxt = clamp(dims[dim] + effective, 0.0, ceiling)
        if abs(nxt - dims[dim]) < 1e-6:
            continue
        applied[dim] = round(nxt - dims[dim], 4)
        dims[dim] = round(nxt, 4)
    return {"dims": dims, "applied": applied or None}


# ---------------------------------------------------------------------------
# 检索重排（MMTR 的权重结构）
# ---------------------------------------------------------------------------
def retrieval_score(similarity: float, channel_weights: Dict[str, float], importance: float,
                    calendar: float = 0.0, theme: float = 0.0,
                    lateral_penalty: float = 0.0, read_only: bool = False) -> float:
    cfg_weights = DEFAULT_CONFIG["retrieval"]["weights"]
    score = (
        cfg_weights["similarity"] * clamp01(similarity)
        + cfg_weights["gist"] * clamp01(channel_weights.get("gist", 0.0))
        + cfg_weights["fact"] * clamp01(channel_weights.get("fact", 0.0))
        + cfg_weights["affect"] * clamp01(channel_weights.get("affect", 0.0))
        + cfg_weights["importance"] * clamp01(importance)
        + cfg_weights["calendar"] * clamp01(calendar)
        + cfg_weights["theme"] * clamp01(theme)
    )
    score -= DEFAULT_CONFIG["retrieval"]["lateral_inhibition"] * clamp01(lateral_penalty)
    if read_only:
        score -= DEFAULT_CONFIG["retrieval"]["read_only_penalty"]
    return round(score, 4)
