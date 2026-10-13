const crypto = require("node:crypto");

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIR_TTL = 5 * 60 * 1000;
const TOKEN_TTL = 2 * 60 * 60 * 1000;

function config(env = process.env) {
    const pairing = env.CAST_PAIRING_SECRET;
    const encryption = env.CAST_MEDIA_ENCRYPTION_KEY;
    if (!pairing || !encryption) throw new Error("CAST_PAIRING_SECRET and CAST_MEDIA_ENCRYPTION_KEY are required.");
    const key = Buffer.from(encryption, /^[0-9a-f]{64}$/i.test(encryption) ? "hex" : "base64");
    if (key.length !== 32) throw new Error("CAST_MEDIA_ENCRYPTION_KEY must decode to 32 bytes.");
    return { pairing, key };
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function codeFor(sessionId, secret, now = Date.now()) {
    const bucket = Math.floor(now / PAIR_TTL);
    const mac = crypto.createHmac("sha256", secret).update(`${sessionId}:${bucket}`).digest();
    let value = mac.readBigUInt64BE(0);
    let result = "";
    for (let i = 0; i < 8; i++) { result = CROCKFORD[Number(value & 31n)] + result; value >>= 5n; }
    return `${result.slice(0, 4)}-${result.slice(4)}`;
}
function encryptMediaUrl(url, key, iv = crypto.randomBytes(12)) {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}
function decryptMediaUrl(value, key) {
    const [encodedIv, encodedCiphertext, encodedTag, ...extra] = String(value || "").split(".");
    if (!encodedIv || !encodedCiphertext || !encodedTag || extra.length) throw new Error("cast_media_ciphertext_invalid");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}
function hashToken(token) { return digest(token); }
function publicReceiverState(row) {
    return row ? { state: row.receiver_state || "idle", acknowledged: Boolean(row.receiver_acknowledged), position_seconds: Number(row.receiver_position_seconds) || 0, reported_at: row.receiver_reported_at || null } : null;
}
function createReceiverService({ env = process.env, now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
    let settings = null;
    try {
        settings = config(env);
    } catch (e) {
        console.warn("[cast-receiver] CAST_PAIRING_SECRET / CAST_MEDIA_ENCRYPTION_KEY 未配置，投屏配对与媒体加密将不可用。", e.message);
        // 返回降级桩：服务正常启动，但配对/加密功能禁用
        return {
            pairingCode: () => null,
            pairingExpiresAt: () => null,
            encryptMediaUrl: (url) => url,
            decryptMediaUrl: (value) => { throw new Error("cast_encryption_disabled"); },
            createToken: () => { const token = randomBytes(32).toString("base64url"); return { token, tokenHash: hashToken(token) }; },
            hashToken,
            tokenTtl: TOKEN_TTL,
            pairTtl: PAIR_TTL,
            publicReceiverState
        };
    }
    return {
        pairingCode: (sessionId) => codeFor(sessionId, settings.pairing, now()),
        pairingExpiresAt: () => new Date((Math.floor(now() / PAIR_TTL) + 1) * PAIR_TTL).toISOString(),
        encryptMediaUrl: (url) => encryptMediaUrl(url, settings.key),
        decryptMediaUrl: (value) => decryptMediaUrl(value, settings.key),
        createToken: () => { const token = randomBytes(32).toString("base64url"); return { token, tokenHash: hashToken(token) }; },
        hashToken,
        tokenTtl: TOKEN_TTL,
        pairTtl: PAIR_TTL,
        publicReceiverState
    };
}

module.exports = { PAIR_TTL, TOKEN_TTL, codeFor, config, createReceiverService, decryptMediaUrl, encryptMediaUrl, hashToken, publicReceiverState };
