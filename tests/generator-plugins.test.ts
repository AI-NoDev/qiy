import { expect, test } from "bun:test";
import { renderAppFiles } from "../tools/commands/generate-app";

test("generator plugins add files and are recorded in the manifest", async () => {
  const rendered = await renderAppFiles("examples/catalog/app.qiy", {
    plugins: ["tests/fixtures/plugin.ts"],
    pluginRoot: process.cwd(),
  });
  expect(rendered.files["docs/generated-by-plugin.md"]).toContain("# qiy-catalog-admin");
  expect(rendered.files["apps/server/src/extensions/plugin-marker.ts"]).toContain("pluginMarker");
  const manifest = JSON.parse(rendered.files[".qiy-generated.json"]!);
  expect(manifest.files).toContain("docs/generated-by-plugin.md");
});

test("generator plugins cannot overwrite core generated files", async () => {
  await expect(renderAppFiles("examples/catalog/app.qiy", {
    plugins: ["tests/fixtures/plugin-overwrite.ts"],
    pluginRoot: process.cwd(),
  })).rejects.toThrow("cannot overwrite generated file package.json");
});
