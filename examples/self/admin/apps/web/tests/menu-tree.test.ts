import { expect, test } from "bun:test";
import { buildMenuTree, openMenuKeys, selectedMenuKey, type MenuTreeGroup, type MenuTreeResource } from "../app/components/menu";

/**
 * The sidebar tree must be grouped: the model `menu { group ... }` block becomes
 * collapsible submenus and the flat fallback only applies when no groups exist.
 * These are pure-function tests, so they run without a browser.
 */
function resource(name: string, label = name): MenuTreeResource {
  return { name, label, labelKey: "qiy.resources." + name + ".label", pluralKey: "qiy.resources." + name + ".plural", icon: "TableOutlined" };
}

function group(name: string, resources: string[], extra: Partial<MenuTreeGroup> = {}): MenuTreeGroup {
  return { name, label: name, labelKey: "qiy.menu." + name.replace(/^menu-/, "") + ".label", icon: "AppstoreOutlined", resources, ...extra };
}

const keys = (nodes: ReadonlyArray<{ key: string }>) => nodes.map((node) => node.key);

test("groups resources into nested items in declared order", () => {
  const tree = buildMenuTree({
    resources: [resource("users"), resource("orders"), resource("orderItems"), resource("inventory")],
    menuGroups: [
      group("menu-masterData", ["users"]),
      group("menu-sales", ["orderItems", "orders"]),
      group("menu-inventory", ["inventory"]),
    ],
  });
  // Overview first, then groups in menu declaration order — not one flat list.
  expect(keys(tree)).toEqual(["qiy-overview", "menu-masterData", "menu-sales", "menu-inventory"]);
  expect(tree[1]!.to).toBeUndefined();
  // Resources keep the order declared inside the group (not resource-module order).
  expect(keys(tree[2]!.children)).toEqual(["orderItems", "orders"]);
  expect(tree[2]!.children[1]!.to).toBe("/orders");
  expect(tree[2]!.children[1]!.labelKey).toBe("qiy.resources.orders.plural");
});

test("keeps submenus collapsed groups and appends ungrouped resources at the root", () => {
  const tree = buildMenuTree({
    resources: [resource("boms"), resource("orders"), resource("users")],
    menuGroups: [group("menu-sales", ["orders"])],
  });
  expect(keys(tree)).toEqual(["qiy-overview", "menu-sales", "boms", "users"]);
  expect(tree[1]!.children).toHaveLength(1);
  expect(tree[1]!.to).toBeUndefined();
});

test("nests @parent groups instead of flattening them", () => {
  const tree = buildMenuTree({
    resources: [resource("orders"), resource("inventory"), resource("users")],
    menuGroups: [
      group("menu-operations", []),
      group("menu-sales", ["orders"], { parent: "menu-operations" }),
      group("menu-inventory", ["inventory"], { parent: "menu-operations" }),
      group("menu-masterData", ["users"]),
    ],
  });
  expect(keys(tree)).toEqual(["qiy-overview", "menu-operations", "menu-masterData"]);
  expect(keys(tree[1]!.children)).toEqual(["menu-sales", "menu-inventory"]);
  expect(keys(tree[1]!.children[0]!.children)).toEqual(["orders"]);
  // The submenu chain of the current route is exposed for controlled open keys.
  expect(openMenuKeys(tree, "orders")).toEqual(["menu-operations", "menu-sales"]);
  expect(openMenuKeys(tree, "users")).toEqual(["menu-masterData"]);
  expect(openMenuKeys(tree, undefined)).toEqual([]);
});

test("keeps an orphaned group reachable and skips unknown/duplicate resources", () => {
  const tree = buildMenuTree({
    resources: [resource("orders"), resource("users")],
    menuGroups: [
      group("menu-sales", ["orders", "missing"]),
      group("menu-duplicate", ["orders"]),
      group("menu-orphan", ["users"], { parent: "menu-notThere" }),
    ],
  });
  expect(keys(tree)).toEqual(["qiy-overview", "menu-sales", "menu-duplicate", "menu-orphan"]);
  expect(keys(tree[1]!.children)).toEqual(["orders"]);
  expect(tree[2]!.children).toEqual([]);
  expect(keys(tree[3]!.children)).toEqual(["users"]);
});

test("falls back to a flat menu when the model declares no groups", () => {
  const tree = buildMenuTree({ resources: [resource("users"), resource("orders")], menuGroups: [] });
  expect(keys(tree)).toEqual(["qiy-overview", "users", "orders"]);
  expect(tree[1]!.children).toEqual([]);
});

test("resolves the selected menu key and current submenu keys from the route", () => {
  const tree = buildMenuTree({
    resources: [resource("orders"), resource("users")],
    menuGroups: [group("menu-sales", ["orders"]), group("menu-system", ["users"])],
  });
  expect(selectedMenuKey(tree, "/")).toBe("qiy-overview");
  expect(selectedMenuKey(tree, "/orders")).toBe("orders");
  expect(selectedMenuKey(tree, "/orders/00000000-0000-4000-8000-000000000001")).toBe("orders");
  expect(selectedMenuKey(tree, "/orders/00000000-0000-4000-8000-000000000001/edit")).toBe("orders");
  expect(selectedMenuKey(tree, "/auth/login")).toBeUndefined();
  expect(openMenuKeys(tree, selectedMenuKey(tree, "/orders"))).toEqual(["menu-sales"]);
});
