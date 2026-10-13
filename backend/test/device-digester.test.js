"use strict";

const assert = require("node:assert");
const test = require("node:test");
const {
    digestEvent,
    isNightChargeHour,
    nightKey
} = require("../services/device-digester");

// Night rules read host-local calendar time, while elapsed-time fixtures keep explicit offsets.
function localNightFixture(hour, minute = 0) {
    return new Date(2026, 7, 16, hour, minute);
}

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
    const now = localNightFixture(23, 40);
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
        now: localNightFixture(23, 55)
    });
    assert.equal(second.injects.length, 0);
});

test("daytime charging produces no goodnight inject", () => {
    const result = digestEvent({
        latest: {},
        event: { trigger: "charging", charging: true },
        now: localNightFixture(15)
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
    const before = nightKey(localNightFixture(5, 59));
    const after = nightKey(localNightFixture(6, 1));
    assert.equal(before, "2026-08-15");
    assert.equal(after, "2026-08-16");
    assert.equal(isNightChargeHour(localNightFixture(23, 30)), true);
    assert.equal(isNightChargeHour(localNightFixture(12)), false);
});
