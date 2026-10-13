import sharp from "sharp";
import fs from "fs";

const size = 108;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
  <rect width="108" height="108" rx="16" fill="#1A1A2E"/>
  <polygon points="34,88 40,48 68,48 74,88" fill="#FFFFFF"/>
  <polygon points="44,48 48,28 60,28 64,48" fill="#FFFFFF"/>
  <rect x="46" y="20" width="16" height="8" fill="#FFFFFF" rx="1"/>
  <polygon points="44,20 54,8 64,20" fill="#FFFFFF"/>
  <polygon points="46,24 10,12 10,36" fill="rgba(255,217,168,0.3)"/>
  <polygon points="62,24 98,12 98,36" fill="rgba(255,217,168,0.3)"/>
  <rect x="50" y="58" width="8" height="14" fill="#1A1A2E" rx="1"/>
  <rect x="50" y="76" width="8" height="12" fill="#1A1A2E" rx="1"/>
  <rect x="48" y="24" width="12" height="4" fill="#FFD9A8" rx="1"/>
</svg>`;

const sizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

const baseDir = "android/app/src/main/res";

async function main() {
  // Also generate foreground/background PNGs for legacy
  for (const [dir, px] of Object.entries(sizes)) {
    const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
    const outDir = `${baseDir}/${dir}`;
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      fs.writeFileSync(`${outDir}/${name}`, buf);
    }
    // Generate foreground-only for legacy (white icon on transparent bg)
    const fgSvg = svg.replace('<rect width="108" height="108" rx="16" fill="#1A1A2E"/>', "");
    const fgBuf = await sharp(Buffer.from(fgSvg)).resize(px, px).png().toBuffer();
    fs.writeFileSync(`${outDir}/ic_launcher_foreground.png`, fgBuf);
    // Generate background-only (solid color block)
    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 108 108"><rect width="108" height="108" fill="#1A1A2E"/></svg>`;
    const bgBuf = await sharp(Buffer.from(bgSvg)).resize(px, px).png().toBuffer();
    fs.writeFileSync(`${outDir}/ic_launcher_background.png`, bgBuf);
    console.log(`Generated ${px}px -> ${dir}`);
  }
  console.log("Done! All icons generated.");
}

main().catch((e) => console.error("Error:", e));