import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslintEntry = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
const result = spawnSync(process.execPath, [eslintEntry, "src"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
console.log("JavaScript/JSX static typecheck passed (no TypeScript compiler is configured).");
