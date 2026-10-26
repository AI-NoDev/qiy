import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "../tools/commands/generate-app";
import { explainQiySource } from "../tools/commands/explain";
import { parseQiyProject } from "../tools/qiy-project";
import { isQiyV1Source, translateQiyV1, v1TableName } from "../tools/qiy-v1";

const v1 = `qiy v1;

# Friendly-syntax preview.
project shop
database postgresql

module Catalog {
  entity Product {
    name: text
    price: decimal(12, 2) nullable
  }

  entity Customer {
    name: text unique
  }

  entity Order {
    reference: text unique
    customer: Customer
  }
}
`;

test("detects and translates v1 sources to canonical v0", () => {
  expect(isQiyV1Source(v1)).toBe(true);
  expect(isQiyV1Source("qiy v0;\napplication x { database sqlite {} }")).toBe(false);
  expect(v1TableName("Product")).toBe("products");
  expect(v1TableName("OrderLine")).toBe("order_lines");
  expect(v1TableName("products")).toBe("products");

  const translated = translateQiyV1(v1);
  expect(translated).toContain("qiy v0;");
  expect(translated).toContain("application shop {");
  expect(translated).toContain("database postgresql {}");
  expect(translated).toContain("entity products {");
  expect(translated).toContain("field id UUID @id;");
  expect(translated).toContain("field price Decimal(12, 2) @nullable;");
  expect(translated).toContain("field customerId UUID;");
  expect(translated).toContain("relation ordersCustomer orders customerId customers id one;");
});

test("the existing parser and explain accept v1 directly", () => {
  const project = parseQiyProject(v1);
  expect(project.name).toBe("shop");
  expect(project.database.dialect).toBe("postgresql");
  expect(project.database.entities.map((entity) => entity.tableName)).toEqual(["products", "customers", "orders"]);
  expect(project.database.relations?.[0]).toMatchObject({ fromEntity: "orders", fromField: "customerId", toEntity: "customers", cardinality: "one" });

  const explanation = explainQiySource(v1);
  expect(explanation.entities.map((entity) => entity.name)).toEqual(["products", "customers", "orders"]);
  expect(explanation.relations[0]?.name).toBe("ordersCustomer");
});

test("generates a project from a v1 source", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-v1-generate-"));
  const source = join(root, "app.qiy");
  const output = join(root, "admin");
  writeFileSync(source, v1);
  await generateApp(source, output);
  const manifest = await Bun.file(join(output, ".qiy-generated.json")).json();
  expect(manifest.files.length).toBeGreaterThan(100);
});

test("supports one-to-many fields via a generated child foreign key", () => {
  const source = `project shop
database sqlite
module Sales {
  entity Order {
    reference: text unique
    lines: OrderLine[]
  }
  entity OrderLine {
    sku: text
    quantity: integer
  }
}
`;
  const translated = translateQiyV1(source);
  expect(translated).toContain("entity order_lines {");
  expect(translated).toContain("field orderId UUID @nullable;");
  expect(translated).toContain("relation order_linesOrder order_lines orderId orders id one;");
  const explanation = explainQiySource(source);
  expect(explanation.relations[0]).toMatchObject({ from: "order_lines", fromField: "orderId", to: "orders", cardinality: "one" });
});

test("v1 preview rejects unsupported constructs with actionable errors", () => {
  expect(() => translateQiyV1("project x\nmodule M {\n entity A {\n lines: Missing[]\n }\n}\n")).toThrow(/not declared/);
  expect(() => translateQiyV1("project x\ninclude \"a.qiy\";\n")).toThrow(/include is not supported/);
  expect(() => translateQiyV1("database sqlite\n")).toThrow(/missing `project/);
  expect(() => translateQiyV1("project x\nentity A {\n name: text bogus\n}\n")).toThrow(/unsupported field modifier/);
  expect(() => translateQiyV1("project x\nentity A {\n name: text\n}\nentity A {\n x: text\n}\n")).toThrow(/Duplicate entity/);
});
