import { expect, test } from "bun:test";
import { readStoredSiderCollapsed, siderCollapsedStorageKey, storeSiderCollapsed } from "../app/ui";

/**
 * The sider collapse state must survive navigation and reloads, so it is stored
 * in localStorage. A missing, corrupt or unknown value falls back to expanded.
 */
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  };
}

test("persists the collapsed state across reads", () => {
  const { values, storage } = memoryStorage();
  expect(readStoredSiderCollapsed(storage)).toBe(false);
  storeSiderCollapsed(true, storage);
  expect(values.get(siderCollapsedStorageKey)).toBe("collapsed");
  expect(readStoredSiderCollapsed(storage)).toBe(true);
  storeSiderCollapsed(false, storage);
  expect(values.get(siderCollapsedStorageKey)).toBe("expanded");
  expect(readStoredSiderCollapsed(storage)).toBe(false);
});

test("treats a missing or unknown stored value as expanded", () => {
  expect(readStoredSiderCollapsed(memoryStorage().storage)).toBe(false);
  expect(readStoredSiderCollapsed(memoryStorage({ [siderCollapsedStorageKey]: "not-a-state" }).storage)).toBe(false);
  expect(readStoredSiderCollapsed(memoryStorage({ [siderCollapsedStorageKey]: "collapsed" }).storage)).toBe(true);
});
