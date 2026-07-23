import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, "../manhwa_db/db/exports/frontend/stats/updates.json.gz");
const output = path.join(root, "public/data/updates-bootstrap.json.gz");

if (!fs.existsSync(source)) throw new Error(`Missing backend Updates export: ${source}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.copyFileSync(source, output);
console.log(`Updates bootstrap copied to ${output}`);
