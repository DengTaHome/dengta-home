import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({
    path: path.resolve(import.meta.dirname, "..", ".env"),
    quiet: true
});

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

function safeSegments(value) {
    const normalized = String(value || "").replaceAll("\\", "/");
    const segments = normalized.split("/").filter(Boolean);
    if (
        !segments.length ||
        segments.some(
            (segment) =>
                segment === "." ||
                segment === ".." ||
                segment.includes("\0") ||
                segment.includes(":")
        )
    ) {
        throw new Error("Storage object contains an unsafe path.");
    }
    return segments;
}

async function listFiles(storage, bucket, prefix = "") {
    const files = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
        const { data, error } = await storage.from(bucket).list(prefix, {
            limit,
            offset,
            sortBy: { column: "name", order: "asc" }
        });
        if (error) throw error;
        const page = data || [];
        for (const item of page) {
            const objectPath = [prefix, item.name].filter(Boolean).join("/");
            if (item.id || item.metadata) {
                files.push({
                    path: objectPath,
                    metadata: item.metadata || {}
                });
            } else {
                files.push(...(await listFiles(storage, bucket, objectPath)));
            }
        }
        if (page.length < limit) break;
        offset += page.length;
    }
    return files;
}

const output = path.resolve(argument("--output"));
if (!argument("--output")) {
    throw new Error("--output is required.");
}
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !serviceKey) {
    throw new Error("Backend .env must contain Supabase service credentials.");
}

await fs.mkdir(output, { recursive: true });
const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const manifest = {
    created_at: new Date().toISOString(),
    type: "private-storage-archive",
    buckets: {},
    total_files: 0,
    total_bytes: 0,
    contains_private_media: true
};

for (const bucket of ["chat-attachments", "moments"]) {
    const files = await listFiles(client.storage, bucket);
    manifest.buckets[bucket] = [];
    for (const item of files) {
        const segments = safeSegments(item.path);
        const { data, error } = await client.storage
            .from(bucket)
            .download(item.path);
        if (error) throw error;
        const bytes = Buffer.from(await data.arrayBuffer());
        const target = path.join(output, "buckets", bucket, ...segments);
        const relative = path.relative(output, target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("Refusing to write outside the storage snapshot.");
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes);
        const record = {
            path: item.path,
            bytes: bytes.length,
            sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
            content_type:
                item.metadata?.mimetype ||
                item.metadata?.contentType ||
                "application/octet-stream"
        };
        manifest.buckets[bucket].push(record);
        manifest.total_files += 1;
        manifest.total_bytes += bytes.length;
    }
}

await fs.writeFile(
    path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
);

process.stdout.write(
    JSON.stringify({
        total_files: manifest.total_files,
        total_bytes: manifest.total_bytes
    })
);
