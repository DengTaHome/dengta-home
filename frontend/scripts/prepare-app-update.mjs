import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readUpdateManifest, validUpdateDownload } from "../src/app-updates.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
if (!args.apk || !args.notes || !args.url || !args.output) throw new Error("Required: --apk <file> --notes <JSON array file> --url <published APK URL> --output <local manifest file>");
if (!validUpdateDownload(args.url)) throw new Error("APK URL must be an owned GitHub release asset");
const sdk = args.sdk || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
if (!sdk) throw new Error("Set ANDROID_SDK_ROOT or --sdk");
const buildTools = path.join(sdk, "build-tools");
const versions = fs.readdirSync(buildTools).filter(value => /^\d+(\.\d+)+$/.test(value)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const tools = path.join(buildTools, versions[0] || "");
const apk = path.resolve(args.apk);
const badging = execFileSync(path.join(tools, process.platform === "win32" ? "aapt.exe" : "aapt"), ["dump", "badging", apk], { encoding: "utf8", windowsHide: true });
const packageLine = badging.split(/\r?\n/).find(line => line.startsWith("package:")) || "";
const attribute = name => new RegExp(`${name}='([^']+)'`).exec(packageLine)?.[1];
const signerJar = path.join(tools, "lib", "apksigner.jar");
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
const signature = execFileSync(java, ["-jar", signerJar, "verify", "--print-certs", apk], { encoding: "utf8", windowsHide: true });
const expectedSigner = "38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6";
const signers = [...signature.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-f\d]+)/gi)].map(value => value[1].toLowerCase());
if (signers.length !== 1 || signers[0] !== expectedSigner) throw new Error("APK signing certificate differs from the installed release channel; do not publish an incompatible update");
const output = path.resolve(args.output);
if (fs.existsSync(output)) throw new Error("Output already exists; review the new release before replacing any existing manifest");
const bytes = fs.readFileSync(apk);
const manifest = {
  schema_version: 1, package_id: attribute("name"), channel: "stable",
  latest: { version_code: Number(attribute("versionCode")), version: attribute("versionName"), apk_url: args.url,
    sha256: createHash("sha256").update(bytes).digest("hex"), size_bytes: bytes.length,
    published_at: new Date().toISOString(), notes: JSON.parse(fs.readFileSync(path.resolve(args.notes), "utf8")) },
};
readUpdateManifest(manifest, 1);
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, version: manifest.latest.version, versionCode: manifest.latest.version_code, sha256: manifest.latest.sha256, signed: true, published: false }));
