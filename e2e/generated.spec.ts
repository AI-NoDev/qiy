import { expect, test } from "@playwright/test";

test("generated admin creates and lists a product", async ({ page }) => {
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /products/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /新建|Create/i }).click();
  await page.getByLabel("name").fill("E2E Widget");
  await page.getByLabel("price").fill("42");
  await page.getByRole("button", { name: /确定|OK|Create|Save|提交/i }).click();
  await expect(page.getByText("E2E Widget").first()).toBeVisible({ timeout: 15_000 });

  // The view is created by the generated migration and rendered read-only.
  await page.goto("/product_names");
  await expect(page.getByRole("heading", { name: /product_names/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("E2E Widget").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /新建|Create/i })).toHaveCount(0);
});
