import { expect, test } from "bun:test";
import { withPaginationLimit } from "../src/pagination";

test("rejects page sizes above the API limit", async () => {
  const service = withPaginationLimit({ list: async (page: number, pageSize: number) => ({ page, pageSize }) });
  expect(() => service.list(1, 101)).toThrow("Invalid pagination");
  expect(() => service.list(0, 10)).toThrow("Invalid pagination");
  expect(await service.list(2, 50)).toEqual({ page: 2, pageSize: 50 });
});
