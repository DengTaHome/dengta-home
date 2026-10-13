"use strict";

const assert = require("node:assert");
const test = require("node:test");
const {
    digestEvent,
    isNightChargeHour,
    nightKey
} = require("../services/device-digester");

test("presence inject after a long silence", () => {
    const now = new Date("2026-08-16T20:00:00+08:00");
    const result = digestEvent({
        latest: { last_active_at: "2026-08-16T17:00:00+08:00" },
        event: { app_state: "foreground", trigger: "launch" },
        now
    });
    assert.equal(result.injects.length, 1);
    assert.equal(result.injects[0].tag, "presence");
    assert.match(result.injects[0].text, /3\.0小时/);
    assert.ok(result.updates.last_active_at);
});

test("short silence produces no presence inject", () => {
    const now = new Date("2026-08-16T20:00:00+08:00");
    const result = digestEvent({
        latest: { last_active_at: "2026-08-16T19:40:00+08:00" },
        event: { app_state: "foreground", trigger: "scene_change" },
        now
    });
    assert.equal(result.injects.length, 0);
});

test("opened-while-unreplied is shadow-only", () => {
    const result = digestEvent({
        latest: {},
        event: { app_state: "foreground", trigger: "launch" },
        now: new Date("2026-08-16T20:00:00+08:00"),
        lastMessageRole: "assistant"
    });
    assert.equal(result.shadow.length, 1);
    assert.equal(result.shadow[0].kind, "opened_while_unreplied");
    assert.equal(result.injects.filter((inject) => inject.tag === "presence").length, 0);
});

test("goodnight inject fires once per night", () => {
    const now = new Date("2026-08-16T23:40:00+08:00");
    const first = digestEvent({
        latest: {},
        event: { trigger: "charging", charging: true },
        now
    });
    assert.equal(first.injects.length, 1);
    assert.equal(first.injects[0].tag, "goodnight");
    const second = digestEvent({
        latest: { night_charge_key: first.updates.night_charge_key },
        event: { trigger: "charging", charging: true },
        now: new Date("2026-08-16T23:55:00+08:00")
    });
    assert.equal(second.injects.length, 0);
});

test("daytime charging produces no goodnight inject", () => {
    const result = digestEvent({
        latest: {},
        event: { trigger: "charging", charging: true },
        now: new Date("2026-08-16T15:00:00+08:00")
    });
    assert.equal(result.injects.length, 0);
});

test("low battery worry with 3h cooldown", () => {
    const now = new Date("2026-08-16T20:00:00+08:00");
    const first = digestEvent({
        latest: {},
        event: { battery_pct: 12, charging: false },
        now
    });
    assert.equal(first.injects.length, 1);
    assert.equal(first.injects[0].tag, "worry");
    const second = digestEvent({
        latest: { worry_last_at: first.updates.worry_last_at },
        event: { battery_pct: 10, charging: false },
        now: new Date("2026-08-16T21:00:00+08:00")
    });
    assert.equal(second.injects.length, 0);
});

test("emulator events skip worry", () => {
    const result = digestEvent({
        latest: {},
        event: { battery_pct: 5, charging: false, emulator: true },
        now: new Date("2026-08-16T20:00:00+08:00")
    });
    assert.equal(result.injects.length, 0);
});

test("nightKey rolls at 06:00", () => {
    const before = nightKey(new Date("2026-08-16T05:59:00+08:00"));
    const after = nightKey(new Date("2026-08-16T06:01:00+08:00"));
    assert.notEqual(before, after);
    assert.equal(isNightChargeHour(new Date("2026-08-16T23:30:00+08:00")), true);
    assert.equal(isNightChargeHour(new Date("2026-08-16T12:00:00+08:00")), false);
});
