import { chromium, type FullConfig } from "@playwright/test";

const routes = ["/products", "/products/new", "/notes", "/product_names"];

/**
 * Loads every route the specs visit once before they run. The first dev-server
 * request compiles routes and lets Vite optimize dependencies, which reloads the
 * page; absorbing that here keeps it out of the first test's timeout.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("warm-up needs a baseURL");
  const visualEndpoint = process.env.QIY_VISUAL_WS;
  // `e2e:visual` may run without a host browser installed; reuse the container one.
  const browser = await chromium.launch().catch((error: unknown) => {
    if (!visualEndpoint) throw error;
    return chromium.connect(visualEndpoint, { exposeNetwork: "<loopback>" });
  });
  try {
    const page = await browser.newPage();
    for (let pass = 0; pass < 2; pass += 1) {
      for (const route of routes) {
        await page.goto(baseURL + route, { timeout: 120_000 });
        await page.waitForLoadState("networkidle", { timeout: 120_000 });
      }
    }
  } finally {
    await browser.close();
  }
}
