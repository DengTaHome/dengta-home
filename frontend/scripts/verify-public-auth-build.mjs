// Verifies that a production web bundle contains the configured public auth values.
// Run with: npm run verify:public-auth-build (after npm run build).
// Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the process environment.

import fs from "node:fs";
import path from "node:path";

const requiredVariables = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];
const envFileNames = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
];

function readPublicEnvFallback() {
  const values = {};
  for (const fileName of envFileNames) {
    if (!fs.existsSync(fileName)) continue;
    for (const line of fs.readFileSync(fileName, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, rawValue] = match;
      const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
      values[name] = quoted ? quoted[1] ?? quoted[2] ?? "" : rawValue;
    }
  }
  return values;
}

const fallbackEnv = readPublicEnvFallback();
const configuredValues = requiredVariables.map((name) => ({
  name,
  value: String(process.env[name] || fallbackEnv[name] || "").trim(),
}));
const missingVariables = configuredValues
  .filter(({ value }) => !value)
  .map(({ name }) => name);

if (missingVariables.length) {
  throw new Error(
    `Missing required public auth environment variables: ${missingVariables.join(", ")}`,
  );
}

const assetsDirectory = path.resolve("dist", "assets");
if (!fs.existsSync(assetsDirectory)) {
  throw new Error("Production bundle not found. Run npm run build first.");
}

const javascript = fs
  .readdirSync(assetsDirectory)
  .filter((fileName) => fileName.endsWith(".js"))
  .map((fileName) =>
    fs.readFileSync(path.join(assetsDirectory, fileName), "utf8"),
  )
  .join("\n");
const omittedVariables = configuredValues
  .filter(({ value }) => !javascript.includes(value))
  .map(({ name }) => name);

if (omittedVariables.length) {
  throw new Error(
    `Production bundle omitted required public auth values: ${omittedVariables.join(", ")}`,
  );
}

console.log("Production bundle contains the configured public auth values.");
