import { CanAccess } from "@refinedev/core";
import { Result } from "antd";
import { useParams } from "react-router";
import { Outlet } from "react-router";

export type ResourcePageAction = "list" | "create" | "show" | "edit";

/**
 * Page level authorization for resource routes. The access-control decision is
 * evaluated for the page action before the page renders, so navigating directly
 * to a URL cannot bypass the menu or button visibility rules.
 */
export function ResourcePageGuard({ action }: { action: ResourcePageAction }) {
  const { resource } = useParams();
  if (!resource) return <Outlet />;
  return <CanAccess resource={resource} action={action} fallback={<Result status="403" title="403" subTitle="没有访问该页面的权限 / You are not allowed to open this page" />}><Outlet /></CanAccess>;
}
