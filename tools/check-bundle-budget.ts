import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Bundle-size budget for the built documentation site. */
const dist = fileURLToPath(new URL("../docs/.vitepress/dist", import.meta.url));
const MAX_BYTES = Number(process.env.QIY_DOCS_MAX_BYTES ?? 4_000_000);
let total = 0;
let files = 0;
function walk(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "v0.6" && entry.name !== "og") walk(path);
    } else if (/\.(js|css)$/.test(entry.name)) {
      total += statSync(path).size;
      files += 1;
    }
  }
}
walk(dist);
console.log(`Docs bundle: ${files} JS/CSS files, ${(total / 1024).toFixed(1)} KiB (budget ${(MAX_BYTES / 1024).toFixed(0)} KiB)`);
if (total > MAX_BYTES) {
  console.error("Documentation bundle budget exceeded.");
  process.exit(1);
}
