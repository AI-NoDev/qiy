import { expect, test } from "@playwright/test";

test("generated admin creates and lists a product", async ({ page }) => {
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /products/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /新建|Create/i }).click();
  await page.getByLabel("name").fill("E2E Widget");
  await page.getByLabel("price").fill("42");
  await page.getByRole("button", { name: /确定|OK|Create|Save|提交/i }).click();
  await expect(page.getByText("E2E Widget")).toBeVisible({ timeout: 15_000 });
});
