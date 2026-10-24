import { expect, test } from "bun:test";
import { qiyApiError } from "../app/api-error";
import { createDataProvider } from "../app/data-provider";
const failure = {"error":"采购单必须处于已审批状态","errorKey":"errors.purchaseOrder.notApproved"};
test("translates declared business errors and keeps status and key", () => {
  expect(qiyApiError(failure, 409, "zh-CN")).toMatchObject({ message: "采购单必须处于已审批状态", statusCode: 409, errorKey: failure.errorKey });
  expect(qiyApiError(failure, 409, "en-US")).toMatchObject({ message: "Purchase order must be approved", statusCode: 409, errorKey: failure.errorKey });
  expect(qiyApiError({ error: "fallback", errorKey: "missing" }, 409, "zh-CN").message).toBe("fallback");
  expect(qiyApiError({ error: "literal" }, 409, "zh-CN").message).toBe("literal");
});
test("Refine custom command preserves the localized API error contract", async () => {
  const provider = createDataProvider(async () => Response.json(failure, { status: 409 }));
  await expect(provider.custom!({ url: "/api/v1/commands/receiveInventory", method: "post", payload: {} })).rejects.toMatchObject({ message: failure.error, statusCode: 409, errorKey: failure.errorKey });
});
