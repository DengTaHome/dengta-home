const fs = require("node:fs/promises"), path = require("node:path");
const { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } = require("node:crypto");

function storageError() { return Object.assign(new Error("无法读写当前账号的小红书加密会话，原有资料未被自动清除。"), { code: "xhs_profile_storage_failed", status: 503 }); }
function createEncryptedXhsProfileStore({ directory, secret } = {}) {
    if (!directory || typeof secret !== "string" || secret.length < 32) throw storageError();
    const root = path.resolve(directory), key = createHash("sha256").update("dengta-xhs-profile-v1\0").update(secret).digest();
    function file(session) {
        if (!/^[a-f0-9]{64}$/.test(session || "")) throw storageError();
        const target = path.resolve(root, session + ".json");
        if (!target.startsWith(root + path.sep)) throw storageError();
        return target;
    }
    return {
        async read(session) {
            const target = file(session);
            try {
                if ((await fs.stat(target)).size > 12 * 1024 * 1024) throw storageError();
                const data = JSON.parse(await fs.readFile(target, "utf8"));
                if (data.v !== 1) throw storageError();
                const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "base64"));
                decipher.setAAD(Buffer.from(session)); decipher.setAuthTag(Buffer.from(data.tag, "base64"));
                const plain = Buffer.concat([decipher.update(Buffer.from(data.data, "base64")), decipher.final()]);
                return JSON.parse(plain.toString("utf8"));
            } catch (cause) { if (cause?.code === "ENOENT") return null; throw storageError(); }
        },
        async write(session, value) {
            const target = file(session), temporary = target + "." + randomUUID() + ".tmp";
            try {
                const plain = Buffer.from(JSON.stringify(value), "utf8");
                if (plain.length > 8 * 1024 * 1024) throw storageError();
                const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(session));
                const data = Buffer.concat([cipher.update(plain), cipher.final()]);
                const document = JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
                await fs.mkdir(root, { recursive: true, mode: 0o700 });
                await fs.writeFile(temporary, document, { mode: 0o600, flag: "wx" });
                await fs.rename(temporary, target);
            } catch { await fs.unlink(temporary).catch(() => {}); throw storageError(); }
        }
    };
}
module.exports = { createEncryptedXhsProfileStore };
