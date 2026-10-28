// Capture the current X ondemand.s bundle URL from the user's logged-in Edge.
// Requires Edge started with --remote-debugging-port=9222 and x.com logged in.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("D:/GZdeepseek/_tools/pw/node_modules/playwright-core");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const page = context.pages().find((item) => item.url().includes("x.com")) || await context.newPage();
const urls = [];
page.on("request", (request) => {
  if (request.url().includes("ondemand.s")) urls.push(request.url());
});
await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
const unique = [...new Set(urls)];
console.log(unique[0] || "");
await browser.close();
