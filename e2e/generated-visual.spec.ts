import { expect, test } from "@playwright/test";

// Pixel baselines are rendered by the pinned Playwright Docker browser (see
// tools/e2e-visual.ts), so local and CI runs compare identical font stacks.
for (const colorScheme of ["light", "dark"] as const) {
  test(`generated create form matches the ${colorScheme} pixel baseline`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/products/new");
    await expect(page.getByLabel("price")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`products-create-${colorScheme}.png`, { animations: "disabled", caret: "hide" });
  });
}
