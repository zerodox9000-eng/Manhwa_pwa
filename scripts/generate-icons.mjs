import fs from "node:fs/promises";
import sharp from "sharp";

const source = await fs.readFile("scripts/assets/aeon-icon-master.png");
const png = (size) => sharp(source).resize(size, size, { fit: "cover", kernel: "lanczos3" }).png();

await png(32).toFile("public/favicon-32.png");
await png(180).toFile("public/apple-touch-icon.png");
await png(192).toFile("public/pwa-192.png");
await png(512).toFile("public/pwa-512.png");

// The central A is inside Android's guaranteed mask-safe circle. The outer
// ring is intentionally decorative and may be cropped by launcher shapes.
await png(512).toFile("public/maskable-512.png");

console.log("Generated PWA icons.");
