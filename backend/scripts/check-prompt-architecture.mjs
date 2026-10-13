import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// This guard checks only application-authored prompt literals. It deliberately
// does not scan provider error classifiers, tests, or handoff snapshots.
const promptFiles = [
  "services/ai-service.js",
  "services/companion-interaction.js",
  "services/tenant-diary-update.js",
  "services/tenant-moment-interaction.js",
  "services/tenant-moment-post.js",
  "services/tenant-proactive-message.js",
  "services/tenant-profile-refresh.js",
  "services/visible-inner-monologue.js",
  "routes/intimate-duel.js",
];

const forbiddenPromptPatterns = [
  /不得生成露骨性内容/iu,
  /不能生成露骨性内容/iu,
  /只能(?:提供|改成|讨论)[^\n]{0,24}(?:非露骨|健康范围内)/iu,
  /(?:非露骨|健康范围内)[^\n]{0,24}(?:替代|内容|表达)/iu,
  /(?:do not|must not|cannot|can't|won't)[^\n]{0,40}(?:generate|write|describe)[^\n]{0,40}(?:explicit sexual|sexual content)/iu,
  /only[^\n]{0,20}non[- ]explicit/iu,
];

const findings = [];
for (const relativePath of promptFiles) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of forbiddenPromptPatterns) {
      if (pattern.test(line)) {
        findings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

if (findings.length > 0) {
  console.error("Prompt architecture guard failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("Prompt architecture guard passed: no fixed adult-content boundary prompt was found.");
}
