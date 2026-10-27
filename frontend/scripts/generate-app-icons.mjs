import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = await readFile(
  path.join(repositoryRoot, "public", "app-icon-master.png"),
);
const pngOptions = { compressionLevel: 9, adaptiveFiltering: true };

async function renderIcon(relativePath, size) {
  await sharp(source)
    .resize(size, size)
    .png(pngOptions)
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
    .png(pngOptions)
    .toFile(path.join(base, "ic_launcher.png"));
  await sharp(source)
    .resize(size, size)
    .png(pngOptions)
    .toFile(path.join(base, "ic_launcher_round.png"));

  const adaptiveSize = Math.round(size * 2.25);
  const foregroundSize = Math.round(adaptiveSize * 2 / 3);
  const inset = Math.floor((adaptiveSize - foregroundSize) / 2);
  const extendedArtwork = await sharp(source)
    .resize(adaptiveSize, adaptiveSize)
    .blur(Math.max(0.3, adaptiveSize * 0.02))
    .png(pngOptions)
    .toBuffer();
  const foregroundArtwork = await sharp(source)
    .resize(foregroundSize, foregroundSize)
    .png(pngOptions)
    .toBuffer();
  // Keep the complete portrait in Android's 72/108 viewport; motion reveals matching artwork.
  await sharp(extendedArtwork)
    .composite([{ input: foregroundArtwork, top: inset, left: inset }])
    .png(pngOptions)
    .toFile(path.join(base, "ic_launcher_foreground.png"));
  await sharp(extendedArtwork)
    .png(pngOptions)
    .toFile(path.join(base, "ic_launcher_background.png"));
}

console.log("DengTa icon assets generated from public/app-icon-master.png");
