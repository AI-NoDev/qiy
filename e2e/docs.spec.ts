import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("documentation home renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Qiy/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("CLI guide is reachable and readable", async ({ page }) => {
  await page.goto("/guide/cli");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/CLI/i);
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("documentation has no serious accessibility violations", async ({ page }) => {
  await page.goto("/guide/tasks");
  // VitePress 1.6 local-search renders a localized visible label with the
  // English aria-label "Search"; that known upstream mismatch is excluded so
  // the gate still catches contrast/structure problems.
  const results = await new AxeBuilder({ page }).disableRules(["label-content-name-mismatch"]).analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});
