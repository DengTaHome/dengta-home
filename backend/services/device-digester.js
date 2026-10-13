"use strict";

// 设备信号 digester（教程四规则安卓化）：
//  ① 她来了：沉默 ≥ PRESENCE_GAP_H 小时后回到前台 → 注入 presence；
//  ② 影子模式："已读未回"只记录不注入；
//  ③ 晚安旁证：23:00–06:00 插充电，每晚一次 → 注入 goodnight；
//  ④ 关心素材：电量 ≤20% 且未充电 → 情绪素材 worry（3 小时冷却）。
// 纯函数实现，便于单元测试；不包含任何内容限制。

const PRESENCE_GAP_H = 1.5;
const WORRY_BATT_PCT = 20;
const WORRY_COOLDOWN_S = 3 * 3600;

function hoursBetween(fromIso, toDate) {
    const from = Date.parse(fromIso);
    if (!Number.isFinite(from)) return null;
    return Math.max(0, (toDate.getTime() - from) / 3600000);
}

function nightKey(date) {
    const d = new Date(date);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    const keyDate = local.getUTCHours() < 6
        ? new Date(local.getTime() - 24 * 3600000)
        : local;
    return `${keyDate.getUTCFullYear()}-${String(keyDate.getUTCMonth() + 1).padStart(2, "0")}-${String(keyDate.getUTCDate()).padStart(2, "0")}`;
}

function isNightChargeHour(date) {
    const hour = date.getHours();
    return hour >= 23 || hour < 6;
}

function digestEvent({
    latest = {},
    event = {},
    now = new Date(),
    lastMessageRole = ""
} = {}) {
    const injects = [];
    const updates = {};
    const shadow = [];
    const isForeground = String(event.app_state) === "foreground";
    const trigger = String(event.trigger || "");
    const cameBack = isForeground && ["launch", "scene_change"].includes(trigger);
    const hour = now.getHours();

    // ① presence：长沉默后回来
    if (cameBack) {
        const gap = hoursBetween(latest.last_active_at, now);
        if (gap !== null && gap >= PRESENCE_GAP_H) {
            injects.push({
                tag: "presence",
                text: `她来了——沉默${gap.toFixed(1)}小时后刚打开app。说不说话、说什么，你自己定。`
            });
        }
        // ② 影子：已读未回只记录
        if (lastMessageRole === "assistant") {
            shadow.push({ kind: "opened_while_unreplied", ts: now.toISOString() });
        }
    }

    // ③ 晚安旁证（每晚一次）
    if (String(event.trigger) === "charging" && event.charging === true && isNightChargeHour(now)) {
        const key = nightKey(now);
        if (latest.night_charge_key !== key) {
            injects.push({
                tag: "goodnight",
                text: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}她插上了充电——大概准备睡了。`
            });
            updates.night_charge_key = key;
        }
    }

    // ④ 低电量关心（3 小时冷却）
    const battery = Number(event.battery_pct);
    if (
        Number.isFinite(battery) &&
        battery <= WORRY_BATT_PCT &&
        event.charging !== true &&
        String(event.emulator) !== "true"
    ) {
        const lastWorry = Date.parse(latest.worry_last_at || "");
        const cooldownPassed = !Number.isFinite(lastWorry) ||
            (now.getTime() - lastWorry) / 1000 >= WORRY_COOLDOWN_S;
        if (cooldownPassed) {
            injects.push({
                tag: "worry",
                text: `她的手机电量只有 ${Math.round(battery)}% 而且没在充电。可以晚点温和地提一句，别唠叨。`
            });
            updates.worry_last_at = now.toISOString();
        }
    }

    // 末次活跃：前台任何事件都算；scene_change 也是活跃边界
    if (isForeground || trigger === "scene_change") {
        updates.last_active_at = now.toISOString();
    }

    return { injects, updates, shadow };
}

module.exports = {
    PRESENCE_GAP_H,
    WORRY_BATT_PCT,
    WORRY_COOLDOWN_S,
    digestEvent,
    isNightChargeHour,
    nightKey
};
