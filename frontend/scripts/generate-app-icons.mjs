import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  "..",
);
const source = await readFile(
  path.join(repositoryRoot, "public", "app-icon-master.png"),
);

async function renderIcon(relativePath, size) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(repositoryRoot, relativePath));
}

await renderIcon("public/app-icon-192.png", 192);
await renderIcon("public/app-icon-512.png", 512);
await renderIcon("public/apple-touch-icon.png", 180);

const densities = {
  ldpi: 36,
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

for (const [density, size] of Object.entries(densities)) {
  const base = path.join(
    repositoryRoot,
    "android",
    "app",
    "src",
    "main",
    "res",
    `mipmap-${density}`,
  );
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(base, "ic_launcher.png"));
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(base, "ic_launcher_round.png"));

  const adaptiveSize = Math.round(size * 2.25);
  const foregroundSize = Math.round(adaptiveSize * 2 / 3);
  const inset = Math.floor((adaptiveSize - foregroundSize) / 2);
  await sharp(source)
    .resize(foregroundSize, foregroundSize)
    .extend({
      top: inset,
      left: inset,
      bottom: adaptiveSize - foregroundSize - inset,
      right: adaptiveSize - foregroundSize - inset,
      background: "#074c5b",
    })
    .png()
    .toFile(path.join(base, "ic_launcher_foreground.png"));
  await sharp({
    create: {
      width: adaptiveSize,
      height: adaptiveSize,
      channels: 4,
      background: "#074c5b",
    },
  })
    .png()
    .toFile(path.join(base, "ic_launcher_background.png"));
}

console.log("DengTa icon assets generated from public/app-icon-master.png");
