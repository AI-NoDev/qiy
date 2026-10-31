import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Manifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const root = resolve(import.meta.dir, "..");
const manifests = [
  join(root, "package.json"),
  join(root, "templates", "admin", "package.json"),
  join(root, "templates", "admin", "apps", "server", "package.json"),
  join(root, "templates", "admin", "apps", "web", "package.json"),
];
const components = new Map<string, { name: string; version: string; scope: string }>();
for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  for (const [scope, dependencies] of [
    ["required", manifest.dependencies ?? {}],
    ["optional", manifest.devDependencies ?? {}],
  ] as const) {
    for (const [name, version] of Object.entries(dependencies)) {
      if (!components.has(name)) components.set(name, { name, version: version.replace(/^[\^~]/, ""), scope });
    }
  }
}
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: { type: "application", name: "qiy", version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version },
  },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)).map((component) => ({
    type: "library",
    name: component.name,
    version: component.version,
    scope: component.scope,
    purl: `pkg:npm/${component.name.replace("@", "%40")}@${component.version}`,
  })),
};
const destination = join(root, "qiy-sbom.json");
writeFileSync(destination, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`Wrote ${components.size} components to ${destination}`);
