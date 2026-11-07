import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Fails when a built docs page links to a `#fragment` that the target page does not define. */
const dist = "docs/.vitepress/dist";
const base = (process.env.VITEPRESS_BASE ?? "/").replace(/\/?$/, "/");
const pages = readdirSync(dist, { recursive: true, encoding: "utf8" })
  .map((path) => path.replace(/\\/g, "/"))
  .filter((path) => path.endsWith(".html") && !/^v\d/.test(path));
const ids = new Map<string, Set<string>>();
const idsOf = (file: string) => {
  let found = ids.get(file);
  if (!found) {
    found = new Set([...readFileSync(file, "utf8").matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
    ids.set(file, found);
  }
  return found;
};

const broken = new Set<string>();
for (const page of pages) {
  for (const [, href, rawFragment] of readFileSync(join(dist, page), "utf8").matchAll(/href="([^"#]*)#([^"]+)"/g)) {
    if (href && !href.startsWith(base)) continue;
    const path = href ? decodeURIComponent(href.slice(base.length - 1)).replace(/\.html$/, "") : "";
    const target = !path ? join(dist, page) : path.endsWith("/") ? join(dist, path, "index.html") : join(dist, `${path}.html`);
    const fragment = decodeURIComponent(rawFragment!);
    if (!existsSync(target)) broken.add(`${page}: ${href}#${fragment} (no such page)`);
    else if (!idsOf(target).has(fragment)) broken.add(`${page}: ${href || "(same page)"}#${fragment}`);
  }
}

if (broken.size) {
  console.error(`Broken docs anchors:\n${[...broken].join("\n")}`);
  process.exit(1);
}
console.log(`Docs anchors: ${pages.length} pages checked`);
