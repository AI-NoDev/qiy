import type { Elysia } from "elysia";












export interface PluginContext {
  repositories: import("../app").Repositories;
  authenticate: import("../auth/guard").Authenticator;
}
export interface QiyPlugin {
  name: string;
  setup(app: any, context?: PluginContext): any;
}

export const plugins: QiyPlugin[] = [









];
export async function registerPlugins(app: Elysia, context?: PluginContext): Promise<Elysia> {
  let configured: any = app;
  for (const plugin of plugins) configured = await plugin.setup(configured, context);
  return configured as Elysia;
}
