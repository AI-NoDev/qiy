import { expect, test } from "bun:test";
import { buildMenuTree } from "../app/components/menu";
import { menuGroups, resources } from "../app/resources";
import { overviewEnabled, qiyFeatureFlags, qiyMenuLinks } from "../app/features";

test("exposes the feature flags and developer-page menu links in order", () => {
  expect(qiyFeatureFlags).toEqual({ overview: true, apiDocs: true, apiKeys: true });
  expect(overviewEnabled).toBe(true);
  expect(qiyMenuLinks).toEqual([
  {
    "name": "qiy-docs",
    "path": "/system/overview",
    "label": "功能总览",
    "labelKey": "qiy.docs.title",
    "icon": "AppstoreOutlined",
    "group": "system"
  },
  {
    "name": "qiy-api-docs",
    "path": "/system/api-docs",
    "label": "API 文档",
    "labelKey": "qiy.apiDocs.title",
    "icon": "FileTextOutlined",
    "group": "system"
  },
  {
    "name": "qiy-api-keys",
    "path": "/system/api-keys",
    "label": "访问密钥",
    "labelKey": "qiy.apiKey.title",
    "icon": "KeyOutlined",
    "group": "system"
  }
]);
  const tree = buildMenuTree({ resources, menuGroups, links: qiyMenuLinks });
  const systemGroup = tree.find((node) => node.key === "menu-system") ?? tree.find((node) => node.children.some((child) => qiyMenuLinks.some((link) => link.name === child.key)));
  expect(systemGroup).toBeDefined();
  const linkNodes = systemGroup!.children.filter((child) => qiyMenuLinks.some((link) => link.name === child.key));
  expect(linkNodes.map((node) => node.to)).toEqual(qiyMenuLinks.map((link) => link.path));
});
