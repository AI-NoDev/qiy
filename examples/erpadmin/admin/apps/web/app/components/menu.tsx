import { useIsExistAuthentication, useLogout, useMenu, useTranslation, useWarnAboutChange } from "@refinedev/core";
import { ThemedTitle, useThemedLayoutContext, type RefineThemedLayoutSiderProps } from "@refinedev/antd";
import { Button, ConfigProvider, Drawer, Grid, Layout, Menu, theme, type MenuProps } from "antd";
import { BarsOutlined, LeftOutlined, LogoutOutlined, RightOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { qiyIcons } from "../icons";
import { menuGroups, resources } from "../resources";
import { qiyMenuLinks } from "../features";

/**
 * Sidebar menu: the model `menu { group ... }` block becomes collapsible
 * submenus instead of one flat list.
 *
 * `buildMenuTree` is a pure function so ordering/nesting can be unit tested
 * without a browser: groups keep their declaration order, the resources of a
 * group keep the order declared in the group, nested `@parent` groups become
 * child submenus, and resources without a group stay at the root (an app
 * without a `menu` block therefore keeps its previous flat navigation).
 *
 * The sider itself is a thin custom `ThemedLayout` sider: it reuses Refine's
 * themed layout context (collapse/mobile state) and `CanAccess` role filtering,
 * but adds a 248px expanded width, a persisted collapsed state (wired through
 * `QiyThemedLayout` in `app/ui`) and keeps the current route's submenu open.
 */

/** Expanded sider width in px (240-260 keeps long Chinese labels readable). */
export const qiySiderWidth = 248;
/** Icon-only collapsed sider width in px. */
export const qiySiderCollapsedWidth = 72;

export interface MenuTreeResource {
  name: string;
  label: string;
  labelKey?: string;
  pluralKey?: string;
  icon?: string;
}

export interface MenuTreeGroup {
  /** Refine resource name (`menu-<group>`); also the menu key of the submenu. */
  name: string;
  label: string;
  labelKey?: string;
  icon?: string;
  /** Parent group resource name (`menu-<group>`), when the group is nested. */
  parent?: string;
  /** Resources (table names) in the order they should appear in the submenu. */
  resources: string[];
}

export interface QiyMenuNode {
  /** Unique Menu/React key: resource table name or `menu-<group>`. */
  key: string;
  /** Fallback label; `labelKey` is translated at render time when present. */
  label: string;
  labelKey?: string;
  icon?: string;
  /** Resource list route; groups have no route. */
  to?: string;
  children: QiyMenuNode[];
}

export interface BuildMenuTreeOptions {
  /** Prepend the Dashboard/Overview entry. Defaults to true. */
  overview?: boolean;
  /**
   * Extra page links that are not Refine resources (e.g. the generated 功能总览
   * page). Each link is appended to its `group` submenu; a missing group is
   * created as a new root submenu so the page stays reachable.
   */
  links?: ReadonlyArray<MenuTreePageLink>;
}

export interface MenuTreePageLink {
  name: string;
  path: string;
  label: string;
  labelKey?: string;
  icon?: string;
  /** Menu group name without the `menu-` prefix. */
  group?: string;
}

function resourceNode(resource: MenuTreeResource): QiyMenuNode {
  return {
    key: resource.name,
    label: resource.label,
    ...(resource.pluralKey ?? resource.labelKey ? { labelKey: resource.pluralKey ?? resource.labelKey } : {}),
    ...(resource.icon ? { icon: resource.icon } : {}),
    to: "/" + resource.name,
    children: [],
  };
}

/**
 * Builds the nested sidebar tree from generated resource metadata and `menu`
 * groups. Pure function: same input always produces the same tree.
 */
export function buildMenuTree(input: {
  resources: ReadonlyArray<MenuTreeResource>;
  menuGroups: ReadonlyArray<MenuTreeGroup>;
  options?: BuildMenuTreeOptions;
  links?: ReadonlyArray<MenuTreePageLink>;
}): QiyMenuNode[] {
  const { resources: resourceList, menuGroups: groups, options = {}, links = options.links ?? [] } = input;
  const resourcesByName = new Map(resourceList.map((resource) => [resource.name, resource]));
  const nodes = new Map<string, QiyMenuNode>();
  for (const group of groups) {
    nodes.set(group.name, {
      key: group.name,
      label: group.label,
      ...(group.labelKey ? { labelKey: group.labelKey } : {}),
      ...(group.icon ? { icon: group.icon } : {}),
      children: [],
    });
  }
  const roots: QiyMenuNode[] = [];
  // Pass 1: attach groups (in declaration order) to the root or to their parent
  // group, so nested groups keep their declared order.
  for (const group of groups) {
    const node = nodes.get(group.name)!;
    const parent = group.parent ? nodes.get(group.parent) : undefined;
    // An unknown parent must not drop the group: keep it reachable at the root.
    (parent ? parent.children : roots).push(node);
  }
  // Pass 2: append each group's resources in the declared order. Resources that
  // are declared for a group but no longer exist in the model are skipped.
  const grouped = new Set<string>();
  for (const group of groups) {
    const node = nodes.get(group.name)!;
    for (const resourceName of group.resources) {
      if (grouped.has(resourceName)) continue;
      const resource = resourcesByName.get(resourceName);
      if (!resource) continue;
      grouped.add(resourceName);
      node.children.push(resourceNode(resource));
    }
  }
  // Resources without a group list stay reachable at the root (flat menus keep working).
  for (const resource of resourceList) {
    if (!grouped.has(resource.name)) roots.push(resourceNode(resource));
  }
  // Extra page links (功能总览): append to their group, creating the group when the
  // model has no matching menu block.
  for (const link of links) {
    const linkNode: QiyMenuNode = {
      key: link.name,
      label: link.label,
      ...(link.labelKey ? { labelKey: link.labelKey } : {}),
      ...(link.icon ? { icon: link.icon } : {}),
      to: link.path,
      children: [],
    };
    const groupKey = link.group ? `menu-${link.group}` : undefined;
    if (!groupKey) {
      roots.push(linkNode);
      continue;
    }
    const group = nodes.get(groupKey);
    if (group) {
      group.children.push(linkNode);
      continue;
    }
    const created: QiyMenuNode = { key: groupKey, label: link.group ?? "System", labelKey: `qiy.menu.${link.group}.label`, icon: "SettingOutlined", children: [linkNode] };
    nodes.set(groupKey, created);
    roots.push(created);
  }
  if (options.overview !== false) {
    roots.unshift({ key: "qiy-overview", label: "Overview", labelKey: "qiy.overview", icon: "DashboardOutlined", to: "/", children: [] });
  }
  return roots;
}

/** Menu key of the current route: first path segment, or the overview entry for `/`. */
export function selectedMenuKey(tree: ReadonlyArray<QiyMenuNode>, pathname: string): string | undefined {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) return tree.some((node) => node.key === "qiy-overview") ? "qiy-overview" : undefined;
  // Resources can live inside nested submenus, so search the whole tree.
  const stack: QiyMenuNode[] = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.key === segment) return segment;
    stack.push(...node.children);
  }
  return undefined;
}

/** Keys of the submenus that must be open to show `selectedKey` (root → leaf). */
export function openMenuKeys(tree: ReadonlyArray<QiyMenuNode>, selectedKey: string | undefined): string[] {
  if (!selectedKey) return [];
  const trail: string[] = [];
  const visit = (nodes: ReadonlyArray<QiyMenuNode>, ancestors: string[]): boolean => {
    for (const node of nodes) {
      if (node.key === selectedKey) {
        trail.push(...ancestors);
        return true;
      }
      if (node.children.length > 0 && visit(node.children, [...ancestors, node.key])) return true;
    }
    return false;
  };
  visit(tree, []);
  return trail;
}

function menuIcon(name: string | undefined): ReactNode {
  const Icon = name ? qiyIcons[name as keyof typeof qiyIcons] : undefined;
  return Icon ? <Icon /> : <UnorderedListOutlined />;
}

/** Sidebar used by `QiyThemedLayout`: collapsible, nested groups, mobile drawer. */
export function QiySider({ Title }: RefineThemedLayoutSiderProps) {
  const { token } = theme.useToken();
  const direction = useContext(ConfigProvider.ConfigContext)?.direction;
  const { siderCollapsed, setSiderCollapsed, mobileSiderOpen, setMobileSiderOpen } = useThemedLayoutContext();
  const { translate } = useTranslation();
  const breakpoint = Grid.useBreakpoint();
  const location = useLocation();
  const isMobile = typeof breakpoint.lg === "undefined" ? false : !breakpoint.lg;

  const tree = useMemo(() => buildMenuTree({ resources, menuGroups, links: qiyMenuLinks }), []);
  const selectedKey = selectedMenuKey(tree, location.pathname);
  const routeOpenKeys = useMemo(() => openMenuKeys(tree, selectedKey), [tree, selectedKey]);
  const [openKeys, setOpenKeys] = useState<string[]>(routeOpenKeys);
  // Keep the current route's submenu open when navigating, without discarding
  // the submenus the user opened manually.
  useEffect(() => {
    setOpenKeys((current) => {
      const missing = routeOpenKeys.filter((key) => !current.includes(key));
      return missing.length === 0 ? current : [...current, ...missing];
    });
  }, [routeOpenKeys]);

  const label = useCallback((node: QiyMenuNode) => (node.labelKey ? translate(node.labelKey, {}, node.label) : node.label), [translate]);

  const isAuthenticated = useIsExistAuthentication();
  const { warnWhen, setWarnWhen } = useWarnAboutChange();
  const { mutate: mutateLogout } = useLogout();
  const handleLogout = () => {
    if (!warnWhen) {
      mutateLogout();
      return;
    }
    if (window.confirm(translate("warnWhenUnsavedChanges", "Are you sure you want to leave? You have unsaved changes."))) {
      setWarnWhen(false);
      mutateLogout();
    }
  };

  // Refine's `useMenu` already applies the access-control provider to the
  // configured resources; using it keeps the grouped tree filtered without
  // wrapping menu entries in CanAccess (antd's `items` API cannot host wrappers).
  const { menuItems } = useMenu();
  const allowedResourceNames = useMemo(() => {
    const allowed = new Set<string>();
    const known = new Set(resources.map((resource) => resource.name));
    const walk = (items: ReadonlyArray<{ name?: unknown; children?: ReadonlyArray<unknown> }> | undefined): void => {
      for (const item of items ?? []) {
        if (typeof item.name === "string" && known.has(item.name)) allowed.add(item.name);
        walk(item.children as ReadonlyArray<{ name?: unknown; children?: ReadonlyArray<unknown> }> | undefined);
      }
    };
    walk(menuItems as ReadonlyArray<{ name?: unknown; children?: ReadonlyArray<unknown> }> | undefined);
    return allowed;
  }, [menuItems]);

  const siderMenuItems = useMemo<NonNullable<MenuProps["items"]>>(() => {
    const build = (nodes: ReadonlyArray<QiyMenuNode>): NonNullable<MenuProps["items"]> => nodes.flatMap<NonNullable<MenuProps["items"]>[number]>((node) => {
      if (node.children.length > 0) {
        const children = build(node.children);
        return children.length > 0 ? [{ key: node.key, icon: menuIcon(node.icon), label: label(node), children }] : [];
      }
      const isResource = resources.some((resource) => resource.name === node.key);
      if (isResource && !allowedResourceNames.has(node.key)) return [];
      return [{ key: node.key, icon: menuIcon(node.icon), label: <Link to={node.to ?? "/"}>{label(node)}</Link> }];
    });
    const items = build(tree);
    if (isAuthenticated) {
      items.push({ key: "logout", icon: <LogoutOutlined />, label: translate("buttons.logout", "Logout"), onClick: handleLogout });
    }
    return items;
  }, [tree, label, allowedResourceNames, isAuthenticated, translate, handleLogout]);

  const renderMenu = () => <Menu
    mode="inline"
    items={siderMenuItems}
    selectedKeys={selectedKey ? [selectedKey] : []}
    {...(siderCollapsed ? {} : { openKeys, onOpenChange: (keys: string[]) => setOpenKeys(keys) })}
    inlineCollapsed={siderCollapsed}
    style={{ border: "none" }}
    onClick={() => setMobileSiderOpen(false)}
  />;

  const TitleComponent = Title ?? ThemedTitle;
  const title = (collapsed: boolean) => <div
    className="qiy-sider-title"
    style={{ width: collapsed ? qiySiderCollapsedWidth : qiySiderWidth, padding: collapsed ? 0 : "0 16px", display: "flex", justifyContent: collapsed ? "center" : "flex-start", alignItems: "center", height: 64, backgroundColor: token.colorBgElevated, fontSize: 14 }}
  >
    <TitleComponent collapsed={collapsed} />
  </div>;

  if (isMobile) {
    return <>
      <Drawer
        open={mobileSiderOpen}
        onClose={() => setMobileSiderOpen(false)}
        placement={direction === "rtl" ? "right" : "left"}
        closable={false}
        width={qiySiderWidth}
        styles={{ body: { padding: 0 } }}
        maskClosable
      >
        <Layout>
          <Layout.Sider width={qiySiderWidth} style={{ height: "100vh", backgroundColor: token.colorBgContainer, borderRight: `1px solid ${token.colorBgElevated}` }}>
            {title(false)}
            {renderMenu()}
          </Layout.Sider>
        </Layout>
      </Drawer>
      <Button className="qiy-sider-mobile-trigger" size="large" onClick={() => setMobileSiderOpen(true)} icon={<BarsOutlined />} />
    </>;
  }

  const OpenIcon = direction === "rtl" ? RightOutlined : LeftOutlined;
  const CollapsedIcon = direction === "rtl" ? LeftOutlined : RightOutlined;
  const TriggerIcon = siderCollapsed ? CollapsedIcon : OpenIcon;
  return <Layout.Sider
    style={{ backgroundColor: token.colorBgContainer, borderRight: `1px solid ${token.colorBgElevated}` }}
    collapsible
    collapsed={siderCollapsed}
    onCollapse={(collapsed, type) => { if (type === "clickTrigger") setSiderCollapsed(collapsed); }}
    width={qiySiderWidth}
    collapsedWidth={qiySiderCollapsedWidth}
    breakpoint="lg"
    trigger={<Button type="text" style={{ borderRadius: 0, height: "100%", width: "100%", backgroundColor: token.colorBgElevated }}><TriggerIcon style={{ color: token.colorPrimary }} /></Button>}
  >
    {title(siderCollapsed)}
    {renderMenu()}
  </Layout.Sider>;
}
