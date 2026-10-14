import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = path.join(root, "public/app-icon-master.png");
const densities = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function assertOpaqueSize(relativePath, size) {
  const image = sharp(path.join(root, relativePath));
  const metadata = await image.metadata();
  assert.equal(metadata.width, size, relativePath);
  assert.equal(metadata.height, size, relativePath);
  assert.equal(metadata.format, "png", relativePath);
  assert.equal((await image.stats()).isOpaque, true, relativePath);
}

test("the icon master and browser install assets are square opaque PNGs", async () => {
  await assertOpaqueSize("public/app-icon-master.png", 1024);
  for (const [file, size] of [
    ["public/app-icon-192.png", 192],
    ["public/app-icon-512.png", 512],
    ["public/apple-touch-icon.png", 180],
  ]) {
    await assertOpaqueSize(file, size);
    const rendered = await sharp(path.join(root, file)).removeAlpha().raw().toBuffer();
    const expected = await sharp(masterPath).resize(size, size).removeAlpha().raw().toBuffer();
    assert.deepEqual(rendered, expected, file);
  }
});

test("every Android density has matching legacy and adaptive icon resources", async () => {
  for (const [density, size] of Object.entries(densities)) {
    const base = `android/app/src/main/res/mipmap-${density}`;
    const adaptiveSize = Math.round(size * 2.25);
    await assertOpaqueSize(`${base}/ic_launcher.png`, size);
    await assertOpaqueSize(`${base}/ic_launcher_round.png`, size);
    await assertOpaqueSize(`${base}/ic_launcher_foreground.png`, adaptiveSize);
    await assertOpaqueSize(`${base}/ic_launcher_background.png`, adaptiveSize);
    assert.deepEqual(
      await readFile(path.join(root, base, "ic_launcher.png")),
      await readFile(path.join(root, base, "ic_launcher_round.png")),
      density,
    );
  }
});

test("the adaptive viewport preserves the full portrait and its overscan uses the same artwork", async () => {
  for (const [density, size] of Object.entries(densities)) {
    const base = path.join(root, `android/app/src/main/res/mipmap-${density}`);
    const adaptiveSize = Math.round(size * 2.25);
    const viewportSize = Math.round(adaptiveSize * 2 / 3);
    const inset = Math.floor((adaptiveSize - viewportSize) / 2);
    const viewport = await sharp(path.join(base, "ic_launcher_foreground.png"))
      .extract({ left: inset, top: inset, width: viewportSize, height: viewportSize })
      .removeAlpha().raw().toBuffer();
    const portrait = await sharp(masterPath).resize(viewportSize, viewportSize).removeAlpha().raw().toBuffer();
    assert.deepEqual(viewport, portrait, `${density}: Android viewport changed the portrait`);
    const extended = await sharp(path.join(base, "ic_launcher_foreground.png"))
      .extract({ left: 0, top: 0, width: adaptiveSize, height: inset })
      .removeAlpha().raw().toBuffer();
    const background = await sharp(path.join(base, "ic_launcher_background.png"))
      .extract({ left: 0, top: 0, width: adaptiveSize, height: inset })
      .removeAlpha().raw().toBuffer();
    assert.deepEqual(extended, background, `${density}: overscan differs from matching artwork`);
    assert.ok(new Set(background).size > 32, `${density}: adaptive background became a solid border`);
  }
});

test("web and Android launchers reference the generated icon resources", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "public/manifest.webmanifest"), "utf8"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/app-icon-192.png" && icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/app-icon-512.png" && icon.sizes === "512x512"));
  const html = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(html, /rel="icon"[^>]*href="\/app-icon-192\.png"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
  const android = await readFile(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(android, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(android, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  for (const name of ["ic_launcher", "ic_launcher_round"]) {
    const adaptive = await readFile(path.join(root, `android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`), "utf8");
    assert.match(adaptive, /<background android:drawable="@mipmap\/ic_launcher_background"/);
    assert.match(adaptive, /<foreground android:drawable="@mipmap\/ic_launcher_foreground"/);
  }
});
