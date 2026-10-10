import { expect, test } from "bun:test";
import { loadColumns } from "../app/hooks/use-column-visibility";
import { resources } from "../app/resources";

test("keeps column choices per resource and adopts new default columns", () => {
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null } } });
  try {
    const resource = resources[0]!;
    const defaults = loadColumns(resource);
    expect(defaults).toEqual(resource.fields.filter((field) => field.listVisible).map((field) => field.name));
    storage.set("qiy.columns." + resource.name, JSON.stringify({ fields: [resource.fields[0]!.name], selected: [] }));
    expect(loadColumns(resource)).toEqual(defaults.filter((name) => name !== resource.fields[0]!.name));
    if (resources[1]) expect(loadColumns(resources[1])).toEqual(resources[1].fields.filter((field) => field.listVisible).map((field) => field.name));
  } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
});
