import { expect, test } from "@playwright/test";

test("generated admin creates and lists a product", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /products/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /新建|Create/i }).click();
  await page.getByLabel("name").fill("E2E Widget");
  await page.getByLabel("price").fill("42");
  await page.getByRole("button", { name: /确定|OK|Create|Save|提交/i }).click();
  await expect(page.getByText("E2E Widget").first()).toBeVisible({ timeout: 15_000 });
  // The numeric @computed column is derived server-side from price.
  await page.goto("/products");
  await expect(page.getByRole("cell", { name: "84", exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // The view is created by the generated migration and rendered read-only.
  await page.goto("/product_names");
  await expect(page.getByRole("heading", { name: /product_names/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("E2E Widget").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /新建|Create/i })).toHaveCount(0);
});

test("soft-deleted records move to the trash and can be restored", async ({ page }) => {
  test.setTimeout(120_000);
  const title = "E2E Trash " + Date.now();
  await page.goto("/notes");
  await expect(page.getByRole("heading", { name: /notes/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /新建|Create/i }).click();
  await page.getByLabel("title").fill(title);
  await page.getByRole("button", { name: /确定|OK|Create|Save|提交/i }).click();
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator("button.ant-btn-dangerous").click();
  // antd spaces two-character CJK button labels ("删 除"), so confirm via the last (OK) button.
  await page.getByRole("tooltip").getByRole("button").last().click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole("button", { name: /Trash|回收站/i }).click();
  const trashed = page.getByRole("row", { name: new RegExp(title) });
  await expect(trashed).toBeVisible({ timeout: 15_000 });
  await trashed.getByRole("button", { name: /Restore|恢\s*复/i }).click();
  await page.getByRole("tooltip").getByRole("button").last().click();
  await expect(trashed).toHaveCount(0, { timeout: 15_000 });

  await page.goto("/notes");
  await expect(page.getByRole("row", { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 });
});

test("generated view page keeps its read-only layout contract", async ({ page }) => {
  await page.goto("/product_names");
  await expect(page.getByRole("heading", { name: /product_names/i })).toBeVisible({ timeout: 30_000 });
  const layout = await page.evaluate(() => {
    const text = (element: Element | null) => element?.textContent?.trim() ?? "";
    const headerButtons = [...document.querySelectorAll("button")].map((button) => text(button)).filter(Boolean);
    return {
      heading: text(document.querySelector("h3")),
      sidebar: Boolean(document.querySelector(".ant-layout-sider")),
      search: Boolean(document.querySelector('input[placeholder="搜索"]')),
      columns: [...document.querySelectorAll("thead th")].map((column) => text(column)),
      hasCreate: headerButtons.some((label) => /新建|Create/.test(label)),
      hasImport: headerButtons.some((label) => /导入|Import/.test(label)),
      hasExport: headerButtons.some((label) => /导出|Export/.test(label)),
    };
  });
  expect(JSON.stringify(layout, null, 2)).toMatchSnapshot("view-layout.json");
});
