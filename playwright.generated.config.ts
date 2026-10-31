import { defineConfig, devices } from "@playwright/test";

/** E2E against a real generated admin/API workspace (`tmp/e2e-admin`). */
export default defineConfig({
  testDir: "e2e",
  testMatch: "generated.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
