import { expect, test } from "bun:test";
import { mergeRelationOptions } from "../app/relation-options";

test("keeps the loaded options untouched when nothing is selected", () => {
  const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  expect(mergeRelationOptions(options, undefined, undefined)).toEqual(options);
});

test("does not duplicate a selected id that is already on the option page", () => {
  const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  expect(mergeRelationOptions(options, "b", "B record")).toEqual(options);
});

test("prepends the selected record with its display label when it is missing", () => {
  expect(mergeRelationOptions([{ value: "a", label: "A" }], "missing-id", "CUS-1 · Retail Partners Ltd")).toEqual([
    { value: "missing-id", label: "CUS-1 · Retail Partners Ltd" },
    { value: "a", label: "A" },
  ]);
});

test("falls back to the raw id while the selected record is still loading", () => {
  expect(mergeRelationOptions(undefined, "missing-id", undefined)).toEqual([{ value: "missing-id", label: "missing-id" }]);
});
