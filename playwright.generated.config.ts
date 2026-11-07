import { defineConfig, devices } from "@playwright/test";

const visualEndpoint = process.env.QIY_VISUAL_WS;
// Dedicated ports keep the run away from other dev servers; a busy port fails
// instead of silently testing whatever app already listens there.
const webPort = Number(process.env.QIY_E2E_WEB_PORT ?? 5187);
const apiPort = Number(process.env.QIY_E2E_API_PORT ?? 3187);

/** E2E against a real generated admin/API workspace (`tmp/e2e-admin`). */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // Layout snapshots are DOM/text contracts and pixel snapshots come from one
  // pinned container browser, so one baseline works on every host OS.
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{arg}{ext}",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/fixtures/warm-up.ts",
  use: { baseURL: `http://localhost:${webPort}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", testMatch: "generated.spec.ts", use: { ...devices["Desktop Chrome"] } },
    ...(visualEndpoint ? [{
      name: "visual",
      testMatch: "generated-visual.spec.ts",
      use: { ...devices["Desktop Chrome"], connectOptions: { wsEndpoint: visualEndpoint, exposeNetwork: "<loopback>" } },
    }] : []),
  ],
  webServer: [
    {
      command: "bun run ../../tools/cli.ts generate ../../e2e/fixtures/app.qiy . --sync && bun run db:generate && bun run db:migrate && bun run dev:server",
      cwd: "tmp/e2e-admin",
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      env: { PORT: String(apiPort) },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `bun run --cwd apps/web --bun dev --port ${webPort} --strictPort`,
      cwd: "tmp/e2e-admin",
      url: `http://localhost:${webPort}/`,
      env: { QIY_API_PROXY: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
