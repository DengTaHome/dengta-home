const dns = require("node:dns").promises;
const net = require("node:net");

const BLOCKED_HOSTS = /(^|\.)(localhost|local|lan|internal)$/i;
const BLOCKED_WEB_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|bilibili\.com|tiktok\.com|douyin\.com|netflix\.com|pornhub\.com)$/i;

function isPrivateAddress(address) {
    const kind = net.isIP(address);
    if (kind === 4) {
        const [a, b] = address.split(".").map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a >= 224) || (a === 100 && b >= 64 && b <= 127);
    }
    if (kind === 6) {
        const value = address.toLowerCase();
        return value === "::1" || value === "::" || value.startsWith("fe80:") ||
            value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff");
    }
    return true;
}

async function validateDirectMediaUrl(value, { resolver = dns } = {}) {
    let url;
    try { url = new URL(String(value || "")); } catch { throw Object.assign(new Error("媒体地址无效。"), { status: 400, code: "media_url_invalid" }); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        BLOCKED_HOSTS.test(url.hostname) || BLOCKED_WEB_HOSTS.test(url.hostname)) {
        throw Object.assign(new Error("媒体地址无效或已被阻止。"), { status: 400, code: "media_url_invalid" });
    }
    const addresses = typeof resolver === "function"
        ? await resolver(url.hostname)
        : await resolver.lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw Object.assign(new Error("媒体地址无效或已被阻止。"), { status: 400, code: "media_url_invalid" });
    }
    return url.toString();
}

module.exports = { isPrivateAddress, validateDirectMediaUrl };
