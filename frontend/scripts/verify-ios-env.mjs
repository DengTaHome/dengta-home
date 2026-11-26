import { loadEnv } from "vite";
import { pathToFileURL } from "node:url";

export function validateIOSEnvironment(env) {
  for (const name of ["VITE_API_URL", "VITE_SUPABASE_URL"]) {
    let url;
    try { url = new URL(env[name]); } catch { /* Report names, never values. */ }
    if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      /^(localhost|127\.|0\.|\[::1\])/.test(url.hostname) ||
      /(?:^|[.-])(?:your-project|example)(?:[.-]|$)/.test(url.hostname)) {
      throw new Error(`${name}: configure your deployed HTTPS service before preparing iOS.`);
    }
  }
  const key = String(env.VITE_SUPABASE_ANON_KEY || "");
  let role = "";
  try { role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { /* Publishable keys are not JWTs. */ }
  if (!key || /your_|fixture|placeholder/i.test(key) ||
    !(key.startsWith("sb_publishable_") || role === "anon")) {
    throw new Error("VITE_SUPABASE_ANON_KEY: use your public publishable/anon key, never a server secret.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateIOSEnvironment({ ...loadEnv("ios", process.cwd(), "VITE_"), ...process.env });
  console.log("iOS public service configuration validated.");
}
