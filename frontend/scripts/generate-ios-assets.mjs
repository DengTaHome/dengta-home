import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "ios/App/App/Assets.xcassets");
const source = await readFile(path.join(root, "public/app-icon-master.png"));
await sharp(source).resize(1024, 1024).flatten({ background: "#f7f2ed" }).removeAlpha()
  .png().toFile(path.join(assets, "AppIcon.appiconset/AppIcon-512@2x.png"));

const splash = path.join(assets, "Splash.imageset");
const portrait = await sharp(source).resize(512, 512).flatten({ background: "#f7f2ed" }).png().toBuffer();
await sharp({ create: { width: 2732, height: 2732, channels: 3, background: "#f7f2ed" } })
  .composite([{ input: portrait, gravity: "centre" }]).png().toFile(path.join(splash, "splash.png"));
await writeFile(path.join(splash, "Contents.json"), JSON.stringify({
  images: [{ idiom: "universal", filename: "splash.png" }], info: { version: 1, author: "xcode" },
}, null, 2) + "\n");
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await rm(path.join(splash, name), { force: true });
}
console.log("iOS icon and launch assets generated from existing DengTa artwork.");
