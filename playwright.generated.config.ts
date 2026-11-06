import { defineConfig, devices } from "@playwright/test";

const visualEndpoint = process.env.QIY_VISUAL_WS;

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
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", testMatch: "generated.spec.ts", use: { ...devices["Desktop Chrome"] } },
    ...(visualEndpoint ? [{
      name: "visual",
      testMatch: "generated-visual.spec.ts",
      use: { ...devices["Desktop Chrome"], connectOptions: { wsEndpoint: visualEndpoint, exposeNetwork: "<loopback>" } },
    }] : []),
  ],
  webServer: {
    command: "bun run ../../tools/cli.ts generate ../../e2e/fixtures/app.qiy . --sync && bun run db:generate && bun run db:migrate && bun run dev",
    cwd: "tmp/e2e-admin",
    url: "http://localhost:5173/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
