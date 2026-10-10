import type { Elysia } from "elysia";

export interface QiyPlugin {
  name: string;
  setup(app: Elysia): Elysia | Promise<Elysia>;
}
export const plugins: QiyPlugin[] = [];
export async function registerPlugins(app: Elysia): Promise<Elysia> {
  let configured = app;
  for (const plugin of plugins) configured = await plugin.setup(configured);
  return configured;
}
