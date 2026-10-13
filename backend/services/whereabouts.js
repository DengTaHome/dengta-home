"use strict";

// whereabouts-mcp 多租户集成服务（DengTa 服务器版）
// 语义化地点 / 停留点聚合 / 移动中状态 / 电量趋势分析，按 user_id+companion_id 隔离。
// 数据模型与算法语义对齐 whereabouts-mcp（AGPL-3.0）：
//   stayMergeRadius 100m / breakConfirm 200m×2样本 / placeRadius 150m / majorMove 1000m

const PLACE_RADIUS_METERS = 150;
const STAY_MERGE_RADIUS_METERS = 100;
const STAY_BREAK_RADIUS_METERS = 200;
const STAY_BREAK_SAMPLES = 2;
const MAJOR_MOVE_THRESHOLD_METERS = 1000;
const BATTERY_HISTORY_LIMIT = 100;
const STAY_HISTORY_LIMIT = 1000;
const MOVE_HISTORY_LIMIT = 100;

function distanceMeters(lat1, lng1, lat2, lng2) {
    const toRad = (v) => (Number(v) * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2) - toRad(lat1);
    const dLng = toRad(lng2) - toRad(lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function cleanNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function parseKnownPlaces(env = process.env) {
    const places = [];
    const raw = String(env.WHEREABOUTS_KNOWN_PLACES || "").trim();
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    const tag = String(item.tag || "").trim();
                    const lat = cleanNumber(item.latitude);
                    const lng = cleanNumber(item.longitude);
                    if (tag && lat !== null && lng !== null) {
                        places.push({
                            tag,
                            latitude: lat,
                            longitude: lng,
                            radiusMeters: cleanNumber(item.radiusMeters, PLACE_RADIUS_METERS)
                        });
                    }
                }
            }
        } catch { /* 忽略非法配置 */ }
    }
    const home = String(env.WHEREABOUTS_HOME_CENTER || "").trim();
    if (home) {
        const [lat, lng] = home.split(",").map((v) => Number(v));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            places.push({ tag: "home", latitude: lat, longitude: lng, radiusMeters: PLACE_RADIUS_METERS });
        }
    }
    const work = String(env.WHEREABOUTS_WORK_CENTER || "").trim();
    if (work) {
        const [lat, lng] = work.split(",").map((v) => Number(v));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            places.push({ tag: "work", latitude: lat, longitude: lng, radiusMeters: PLACE_RADIUS_METERS });
        }
    }
    return places;
}

function matchPlaceTag(lat, lng, places) {
    for (const place of places) {
        if (distanceMeters(lat, lng, place.latitude, place.longitude) <= place.radiusMeters) {
            return place.tag;
        }
    }
    return null;
}

function createStayFromPoint(point, places) {
    const stay = {
        id: Math.random().toString(36).slice(2, 12),
        enteredAt: point.pointTime,
        lastSeenAt: point.pointTime,
        centerLat: point.latitude,
        centerLng: point.longitude,
        sampleCount: 1,
        batteryLevel: point.batteryLevel,
        address: point.address || null,
        placeTag: matchPlaceTag(point.latitude, point.longitude, places)
    };
    return stay;
}

function mergePointIntoStay(stay, point, places) {
    const previousCount = Math.max(1, Number(stay.sampleCount) || 1);
    const nextCount = previousCount + 1;
    stay.centerLat = (stay.centerLat * previousCount + point.latitude) / nextCount;
    stay.centerLng = (stay.centerLng * previousCount + point.longitude) / nextCount;
    stay.sampleCount = nextCount;
    if (new Date(point.pointTime).getTime() > new Date(stay.lastSeenAt).getTime()) {
        stay.lastSeenAt = point.pointTime;
    }
    if (point.batteryLevel !== null && point.batteryLevel !== undefined) {
        stay.batteryLevel = point.batteryLevel;
    }
    if (point.address) stay.address = point.address;
    const tag = matchPlaceTag(stay.centerLat, stay.centerLng, places);
    if (tag) stay.placeTag = tag;
    return stay;
}

function ingestIntoState(state, point, places) {
    const currentStay = state.currentStay || null;
    if (!currentStay) {
        state.currentStay = createStayFromPoint(point, places);
        state._meta = state._meta || {};
        state._meta.pendingBreak = null;
        return { moved: false, newStay: false };
    }
    const distance = distanceMeters(
        point.latitude,
        point.longitude,
        currentStay.centerLat,
        currentStay.centerLng
    );
    if (distance <= STAY_MERGE_RADIUS_METERS) {
        mergePointIntoStay(currentStay, point, places);
        state._meta = state._meta || {};
        state._meta.pendingBreak = null;
        return { moved: false, newStay: false };
    }
    state._meta = state._meta || {};
    const pending = state._meta.pendingBreak || null;
    if (pending) {
        const toPending = distanceMeters(
            point.latitude,
            point.longitude,
            pending.latitude,
            pending.longitude
        );
        if (toPending <= STAY_BREAK_RADIUS_METERS) {
            pending.count += 1;
            pending.latitude = point.latitude;
            pending.longitude = point.longitude;
            pending.lastSeenAt = point.pointTime;
        } else {
            state._meta.pendingBreak = {
                count: 1,
                latitude: point.latitude,
                longitude: point.longitude,
                lastSeenAt: point.pointTime
            };
        }
    } else {
        state._meta.pendingBreak = {
            count: 1,
            latitude: point.latitude,
            longitude: point.longitude,
            lastSeenAt: point.pointTime
        };
    }
    const confirmCount = state._meta.pendingBreak ? state._meta.pendingBreak.count : 0;
    if (confirmCount >= STAY_BREAK_SAMPLES) {
        const fromLat = currentStay.centerLat;
        const fromLng = currentStay.centerLng;
        state.recentStays = state.recentStays || [];
        state.recentStays.push({ ...currentStay, endedAt: state._meta.pendingBreak.lastSeenAt });
        if (state.recentStays.length > STAY_HISTORY_LIMIT) {
            state.recentStays = state.recentStays.slice(-STAY_HISTORY_LIMIT);
        }
        state.currentStay = createStayFromPoint(point, places);
        const movedMeters = distanceMeters(
            point.latitude,
            point.longitude,
            fromLat,
            fromLng
        );
        if (movedMeters >= MAJOR_MOVE_THRESHOLD_METERS) {
            state.recentMoves = state.recentMoves || [];
            state.recentMoves.push({
                movedAt: point.pointTime,
                fromLat,
                fromLng,
                toLat: point.latitude,
                toLng: point.longitude,
                distanceMeters: Math.round(movedMeters)
            });
            if (state.recentMoves.length > MOVE_HISTORY_LIMIT) {
                state.recentMoves = state.recentMoves.slice(-MOVE_HISTORY_LIMIT);
            }
        }
        state._meta.pendingBreak = null;
        return { moved: movedMeters >= MAJOR_MOVE_THRESHOLD_METERS, newStay: true };
    }
    return { moved: false, newStay: false };
}

function appendBatteryObservation(state, point) {
    if (point.batteryLevel === null || point.batteryLevel === undefined) return;
    state.batteryObservations = state.batteryObservations || [];
    state.batteryObservations.push({
        timestamp: point.pointTime,
        batteryLevel: Math.max(0, Math.min(100, Math.round(Number(point.batteryLevel))))
    });
    if (state.batteryObservations.length > BATTERY_HISTORY_LIMIT) {
        state.batteryObservations = state.batteryObservations.slice(-BATTERY_HISTORY_LIMIT);
    }
}

function buildBatteryTrend(observations, options = {}) {
    const records = (Array.isArray(observations) ? observations : [])
        .filter((obs) => Number.isFinite(Number(obs.batteryLevel)))
        .map((obs) => ({
            percent: Math.max(0, Math.min(100, Math.round(Number(obs.batteryLevel)))),
            timestamp: obs.timestamp
        }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (!records.length) {
        return { source: "battery_observations", sampleCount: 0, values: [], note: "No battery observations yet." };
    }
    const bucketMinutes = Math.max(1, Math.min(60, Number(options.bucketMinutes) || 5));
    const first = records[0];
    const last = records[records.length - 1];
    const firstMs = new Date(first.timestamp).getTime();
    const lastMs = new Date(last.timestamp).getTime();
    const bucketMs = bucketMinutes * 60 * 1000;
    const values = [];
    let cursor = firstMs;
    const byBucket = new Map();
    for (const record of records) {
        const bucketStart = Math.floor((new Date(record.timestamp).getTime() - firstMs) / bucketMs);
        byBucket.set(bucketStart, record.percent);
    }
    let carry = first.percent;
    const maxBucket = Math.max(0, Math.floor((lastMs - firstMs) / bucketMs));
    for (let bucket = 0; bucket <= maxBucket; bucket += 1) {
        if (byBucket.has(bucket)) carry = byBucket.get(bucket);
        values.push(carry);
        cursor += bucketMs;
    }
    const deltaPercent = last.percent - first.percent;
    const durationHours = Math.max(0.001, (lastMs - firstMs) / 3600000);
    const deltaPerHourPercent = Math.round((deltaPercent / durationHours) * 10) / 10;
    const estimatedMinutesToEmpty =
        deltaPerHourPercent < 0 ? Math.max(0, Math.round((last.percent / -deltaPerHourPercent) * 60)) : null;
    const estimatedEmptyAt =
        estimatedMinutesToEmpty !== null && Number.isFinite(lastMs)
            ? new Date(lastMs + estimatedMinutesToEmpty * 60000).toISOString()
            : null;
    return {
        source: "battery_observations",
        sampleCount: records.length,
        firstLevelPercent: first.percent,
        latestLevelPercent: last.percent,
        bucketMinutes,
        values,
        deltaPercent,
        deltaPerHourPercent,
        direction: deltaPercent < 0 ? "draining" : deltaPercent > 0 ? "charging" : "stable",
        estimatedMinutesToEmpty,
        estimatedEmptyAt,
        fillStrategy: "latest_observation_per_bucket_then_carry_forward"
    };
}

function durationText(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}min`;
    return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

function serializeStay(stay) {
    if (!stay) return null;
    const enteredMs = new Date(stay.enteredAt).getTime();
    const lastMs = new Date(stay.lastSeenAt).getTime();
    const durationMs = Number.isFinite(lastMs) && Number.isFinite(enteredMs) ? lastMs - enteredMs : 0;
    return {
        enteredAtLocal: new Date(stay.enteredAt).toLocaleString("zh-CN", { hour12: false }),
        lastSeenAtLocal: new Date(stay.lastSeenAt).toLocaleString("zh-CN", { hour12: false }),
        durationMs,
        durationMinutes: Math.round(durationMs / 60000),
        durationText: durationText(durationMs),
        centerLat: Math.round(stay.centerLat * 1e6) / 1e6,
        centerLng: Math.round(stay.centerLng * 1e6) / 1e6,
        sampleCount: stay.sampleCount,
        placeTag: stay.placeTag || null,
        address: stay.address || null,
        batteryLevel: stay.batteryLevel ?? null
    };
}

function defaultState() {
    return {
        currentStay: null,
        recentStays: [],
        recentMoves: [],
        batteryObservations: [],
        _meta: { pendingBreak: null }
    };
}

async function loadState(database, userId, companionId) {
    const { data, error } = await database
        .from("whereabouts_state")
        .select("state")
        .eq("user_id", userId)
        .eq("companion_id", companionId)
        .maybeSingle();
    if (error) throw error;
    if (!data?.state || typeof data.state !== "object") return defaultState();
    return {
        ...defaultState(),
        ...data.state
    };
}

async function saveState(database, userId, companionId, state) {
    const { error } = await database
        .from("whereabouts_state")
        .upsert({
            user_id: userId,
            companion_id: companionId,
            state,
            updated_at: new Date().toISOString()
        }, { onConflict: "user_id,companion_id" });
    if (error) throw error;
}

// ===== 对外 API =====

async function ingestPoint({ database, userId, companionId, point }) {
    const latitude = cleanNumber(point?.latitude);
    const longitude = cleanNumber(point?.longitude);
    if (latitude === null || longitude === null) {
        const error = new Error("latitude 和 longitude 必须为数字。");
        error.status = 400;
        error.code = "whereabouts_point_invalid";
        throw error;
    }
    const pointTime = new Date(point?.timestamp || point?.capturedAt || Date.now()).toISOString();
    const batteryLevel = point?.batteryLevel !== undefined && point?.batteryLevel !== null && point?.batteryLevel !== ""
        ? Math.max(0, Math.min(100, Math.round(Number(point.batteryLevel))))
        : null;
    const normalized = {
        latitude: Math.round(latitude * 1e6) / 1e6,
        longitude: Math.round(longitude * 1e6) / 1e6,
        pointTime,
        batteryLevel,
        trigger: String(point?.trigger || "manual").trim().slice(0, 40) || "manual",
        address: String(point?.address || "").trim().slice(0, 300) || null
    };
    const places = parseKnownPlaces();
    const state = await loadState(database, userId, companionId);
    const result = ingestIntoState(state, normalized, places);
    appendBatteryObservation(state, normalized);
    await saveState(database, userId, companionId, state);
    const { data, error } = await database
        .from("whereabouts_points")
        .insert({
            user_id: userId,
            companion_id: companionId,
            latitude: normalized.latitude,
            longitude: normalized.longitude,
            battery_level: normalized.batteryLevel,
            trigger: normalized.trigger,
            address: normalized.address,
            point_time: pointTime
        })
        .select("id")
        .single();
    if (error) throw error;
    return {
        ok: true,
        id: data?.id,
        timestamp: pointTime,
        receivedAt: new Date().toISOString(),
        ...result
    };
}

async function getSnapshot({ database, userId, companionId, stayLimit = 5, moveLimit = 5, batteryBucketMinutes = 5 }) {
    const state = await loadState(database, userId, companionId);
    const stays = (state.recentStays || []).slice(-stayLimit).reverse().map(serializeStay);
    const moves = (state.recentMoves || []).slice(-moveLimit).reverse();
    return {
        currentStay: serializeStay(state.currentStay),
        recentStays: stays,
        recentMoves: moves,
        batteryTrend: buildBatteryTrend(state.batteryObservations || [], { bucketMinutes: batteryBucketMinutes })
    };
}

async function getCurrentStay({ database, userId, companionId }) {
    const state = await loadState(database, userId, companionId);
    return { currentStay: serializeStay(state.currentStay) };
}

async function getRecentStays({ database, userId, companionId, limit = 20 }) {
    const state = await loadState(database, userId, companionId);
    return { recentStays: (state.recentStays || []).slice(-limit).reverse().map(serializeStay) };
}

async function getRecentMoves({ database, userId, companionId, limit = 20 }) {
    const state = await loadState(database, userId, companionId);
    return { recentMoves: (state.recentMoves || []).slice(-limit).reverse() };
}

async function getSummary({ database, userId, companionId, range = "day", batteryBucketMinutes = 5 }) {
    const state = await loadState(database, userId, companionId);
    const now = new Date();
    const start = new Date(now);
    if (range === "week") start.setDate(start.getDate() - 7);
    else if (range === "month") start.setMonth(start.getMonth() - 1);
    else start.setHours(0, 0, 0, 0);
    const staysInRange = (state.recentStays || [])
        .filter((stay) => new Date(stay.lastSeenAt).getTime() >= start.getTime())
        .map(serializeStay);
    const movesInRange = (state.recentMoves || []).filter((m) => new Date(m.movedAt).getTime() >= start.getTime());
    const observationsInRange = (state.batteryObservations || []).filter(
        (obs) => new Date(obs.timestamp).getTime() >= start.getTime()
    );
    return {
        range,
        currentStay: serializeStay(state.currentStay),
        staysInRange,
        movesInRange,
        batteryTrend: buildBatteryTrend(observationsInRange, { bucketMinutes: batteryBucketMinutes })
    };
}

module.exports = {
    getCurrentStay,
    getRecentMoves,
    getRecentStays,
    getSnapshot,
    getSummary,
    ingestPoint
};