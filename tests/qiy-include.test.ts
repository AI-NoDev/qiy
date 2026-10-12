import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateApp } from "../tools/commands/generate-app";
import { loadQiyProjectSource } from "../tools/qiy-include";
import { parseQiyProject } from "../tools/qiy-project";

function fixture(): { root: string; write: (path: string, contents: string) => string } {
  const root = mkdtempSync(join(tmpdir(), "qiy-include-"));
  return {
    root,
    write(path, contents) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
      return target;
    },
  };
}

test("expands nested application fragments before parsing and generation", async () => {
  const testFixture = fixture();
  try {
    const source = testFixture.write("app.qiy", `qiy v0;
application modular-catalog {
  database sqlite {}
  // include "ignored.qiy";
  # include "also-ignored.qiy"; } {
  include "modules/catalog.qiy";
}`);
    testFixture.write("modules/catalog.qiy", `include "shared/status.qiy";
entity products @label("Products") {
  field id UUID @id;
  field title Text;
  field status productStatus;
}`);
    testFixture.write("modules/shared/status.qiy", `enum productStatus {
  value draft label "Draft" color "default";
  value active label "Active" color "green";
}`);

    const expanded = await loadQiyProjectSource(source);
    expect(expanded).toContain("enum productStatus");
    expect(expanded).toContain('include "ignored.qiy"');
    const project = parseQiyProject(expanded);
    expect(project.database.enums?.[0]?.name).toBe("productStatus");
    expect(project.database.entities.map((entity) => entity.name)).toEqual(["products"]);

    const output = join(testFixture.root, "admin");
    await generateApp(source, output);
    expect(await Bun.file(join(output, "apps/web/app/resources.ts")).text()).toContain('"name": "products"');
  } finally {
    rmSync(testFixture.root, { recursive: true, force: true });
  }
});

test("selectively imports one top-level messages block", async () => {
  const testFixture = fixture();
  try {
    testFixture.write("modules/catalog.qiy", `messages {
  default "en-US";
  locale "en-US" { "catalog.title" "Catalog"; }
  locale "zh-CN" { "catalog.title" "商品目录"; }
}
enum hiddenStatus { value active; }
entity hiddenProducts { field id UUID @id; }`);
    const source = testFixture.write("app.qiy", `qiy v0;
application selective-messages {
  database sqlite {}
  include "modules/catalog.qiy" @messages;
  entity products { field id UUID @id; field title Text; }
}`);

    const expanded = await loadQiyProjectSource(source);
    expect(expanded).toContain('"catalog.title" "Catalog"');
    expect(expanded).not.toContain("enum hiddenStatus");
    expect(expanded).not.toContain("entity hiddenProducts");
    expect(parseQiyProject(expanded).messages).toEqual({
      defaultLocale: "en-US",
      locales: {
        "en-US": { "catalog.title": "Catalog" },
        "zh-CN": { "catalog.title": "商品目录" },
      },
    });
    const output = join(testFixture.root, "selected-admin");
    await generateApp(source, output);
    expect(await Bun.file(join(output, "apps/web/app/messages.ts")).text()).toContain('"catalog.title": "Catalog"');
    expect(await Bun.file(join(output, "apps/web/app/resources.ts")).text()).not.toContain("hiddenProducts");

    const alias = testFixture.write("alias.qiy", `qiy v0;
application selective-message-alias {
  database sqlite {}
  include "modules/catalog.qiy" @message;
  entity products { field id UUID @id; field title Text; }
}`);
    expect(parseQiyProject(await loadQiyProjectSource(alias)).messages?.defaultLocale).toBe("en-US");

    testFixture.write("modules/no-messages.qiy", "entity products { field id UUID @id; }");
    const missing = testFixture.write("missing.qiy", `qiy v0; application missing-messages { database sqlite {} include "modules/no-messages.qiy" @messages; }`);
    await expect(loadQiyProjectSource(missing)).rejects.toThrow("did not find a top-level messages block");

    testFixture.write("modules/duplicate.qiy", `messages { default "en-US"; locale "en-US" { "a" "A"; } }
messages { default "en-US"; locale "en-US" { "b" "B"; } }`);
    const duplicate = testFixture.write("duplicate.qiy", `qiy v0; application duplicate-messages { database sqlite {} include "modules/duplicate.qiy" @messages; }`);
    await expect(loadQiyProjectSource(duplicate)).rejects.toThrow("matched multiple top-level messages blocks");

    const unsupported = testFixture.write("unsupported.qiy", `qiy v0; application unsupported-selector { database sqlite {} include "modules/catalog.qiy" @menu.operations; }`);
    await expect(loadQiyProjectSource(unsupported)).rejects.toThrow("unsupported include selector @menu.operations");

    testFixture.write("modules/cycle-a.qiy", 'include "cycle-b.qiy"; messages { default "en-US"; locale "en-US" { "a" "A"; } }');
    testFixture.write("modules/cycle-b.qiy", 'include "cycle-a.qiy";');
    const cycle = testFixture.write("cycle.qiy", `qiy v0; application selected-cycle { database sqlite {} include "modules/cycle-a.qiy" @messages; }`);
    await expect(loadQiyProjectSource(cycle)).rejects.toThrow("include cycle detected");
  } finally {
    rmSync(testFixture.root, { recursive: true, force: true });
  }
});

test("rejects unsafe, missing, cyclic, and misplaced includes", async () => {
  const testFixture = fixture();
  try {
    const app = (body: string) => testFixture.write("project/app.qiy", `qiy v0; application safe-app { database sqlite {} ${body} }`);
    await expect(loadQiyProjectSource(app('include "missing.qiy";'))).rejects.toThrow("Included file does not exist");
    await expect(loadQiyProjectSource(app('include "../outside.qiy";'))).rejects.toThrow("cannot contain ..");
    await expect(loadQiyProjectSource(app('include "C:/outside.qiy";'))).rejects.toThrow("must be relative");
    await expect(loadQiyProjectSource(app('include "modules/not-qiy.txt";'))).rejects.toThrow("must reference a .qiy");
    await expect(loadQiyProjectSource(app('entity items { include "modules/item.qiy"; }'))).rejects.toThrow("direct children");

    testFixture.write("project/modules/a.qiy", 'include "b.qiy";');
    testFixture.write("project/modules/b.qiy", 'include "a.qiy";');
    await expect(loadQiyProjectSource(app('include "modules/a.qiy";'))).rejects.toThrow("include cycle detected");

    testFixture.write("outside/secret.qiy", "entity secrets { field id UUID @id; }");
    mkdirSync(join(testFixture.root, "project", "modules"), { recursive: true });
    symlinkSync(join(testFixture.root, "outside"), join(testFixture.root, "project", "modules", "external"), "junction");
    await expect(loadQiyProjectSource(app('include "modules/external/secret.qiy";'))).rejects.toThrow("outside the project root");
  } finally {
    rmSync(testFixture.root, { recursive: true, force: true });
  }
});
