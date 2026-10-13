import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(testDir, "..");
const studio = fs.readFileSync(
  path.join(root, "src", "CompanionCreativeStudio.jsx"),
  "utf8",
);
const profile = fs.readFileSync(
  path.join(root, "src", "CompanionProfile.jsx"),
  "utf8",
);
const chatMessage = fs.readFileSync(
  path.join(root, "src", "ChatMessage.jsx"),
  "utf8",
);
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(
  path.join(root, "src", "cozy-theme.css"),
  "utf8",
);
const stickers = fs.readFileSync(
  path.join(root, "src", "sticker-catalog.js"),
  "utf8",
);

assert.match(studio, /\/api\/v2\/creative/);
assert.match(studio, /每次确认（默认）/);
assert.match(studio, /自主创作/);
assert.match(studio, /关闭图片生成/);
assert.match(studio, /允许秘密惊喜/);
assert.match(studio, /acknowledge_cost: true/);
assert.match(studio, /保存配置（不调用图片模型）/);
assert.match(studio, /\/artworks\/upload/);
assert.match(studio, /createImageBitmap/);
assert.match(studio, /不能超过 12MB/);
assert.match(studio, /处理后的图片仍超过 5MB/);
assert.match(studio, /已加密保存；只在更换时填写/);
assert.match(studio, /实际调用 \{artwork\.actual_call_count\} 次/);
assert.match(studio, /CREATIVE_FAILURE_MESSAGES/);
assert.match(studio, /creative_provider_auth_failed/);
assert.match(studio, /creative_provider_image_missing/);
assert.match(studio, /Promise\.allSettled/);
assert.match(studio, /artworkResult\.value\.metadata_reentry_required/);
assert.match(studio, /returnedArtworks\.some\(artworkNeedsMetadataRecovery\)/);
assert.match(studio, /artworkNeedsMetadataRecovery\(artwork\)/);
assert.match(studio, /creative_artwork_metadata_reentry_required/);
assert.match(studio, /creative_provider_credential_reentry_required/);
assert.match(
  studio,
  /saveProvider[\s\S]*creativeErrorFeedback\(error, IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE\)/,
);
assert.match(studio, /creative_secret_invalid/);
assert.match(studio, /Image API setup required/);
assert.match(studio, /Open image settings/);
assert.match(studio, /Existing images and manual uploads remain stored/);
assert.match(studio, /unfinished artwork must be recreated/);
assert.match(studio, /Re-entering the image API key cannot restore old artwork text/);
assert.doesNotMatch(studio, /text ideas.*remain available/i);
assert.match(studio, /id="creative-provider-settings"/);
assert.match(studio, /Re-enter image API key/);
assert.match(studio, /required=\{providerCredentialRecoveryRequired\}/);
assert.match(
  studio,
  /disabled=\{\s*Boolean\(busy\)\s*\|\|\s*status\.settings\.generation_mode === "off"\s*\}/,
);
assert.match(studio, /disabled=\{Boolean\(busy\)\}\s*onChange=\{uploadArtwork\}/);
assert.match(profile, /onOpenCreativeStudio/);
assert.match(css, /\.creative-credential-recovery/);
assert.match(app, /openCreativeProviderSettings/);
assert.match(app, /scrollIntoView/);
assert.doesNotMatch(studio, /供应商错误：\{artwork\.failure_code\}/);
assert.match(app, /<CompanionArtStudio/);
assert.doesNotMatch(profile, /还没有接入绘图能力/);
assert.match(chatMessage, /is_surprise_reveal/);
assert.match(chatMessage, /AuthenticatedImage/);
assert.match(css, /\.companion-artwork-library/);
assert.match(css, /\.message-artwork/);
assert.doesNotMatch(
  css.match(/\.artwork-card[\s\S]*?\}/)?.[0] || "",
  /backdrop-filter/,
);
assert.match(stickers, /bear-hug/);
assert.match(stickers, /bear-goodnight/);

console.log("frontend companion creative studio tests passed");
