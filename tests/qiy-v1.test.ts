import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEntity, addFeature, addField, addModule } from "../tools/commands/add";
import { generateApp } from "../tools/commands/generate-app";
import { explainQiyFile, explainQiySource } from "../tools/commands/explain";
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

test("passes through v0 config blocks for auth/features/menu/chart", () => {
  const source = `project shop
database sqlite
features {
  apiDocs true;
  apiKeys true;
}
enum role {
  value admin;
  value operator;
  value viewer;
}
auth {
  provider local;
  user users;
  subjectField id;
  roleField role;
  usernameField email;
  passwordField passwordHash;
}
entity User {
  email: text unique
  passwordHash: text
  role: role
}
menu {
  group system {
    resource users;
  }
}
chart const UserCount {
  title = "Users";
  data = count users;
}
`;
  const translated = translateQiyV1(source);
  expect(translated).toContain("features {");
  expect(translated).toContain("apiKeys true;");
  expect(translated).toContain("auth {");
  expect(translated).toContain("enum role {");
  expect(translated).toContain("menu {");
  expect(translated).toContain("chart const UserCount {");
  const explanation = explainQiySource(source);
  expect(explanation.entities.some((entity) => entity.name === "users")).toBe(true);
  expect(explanation.charts[0]?.name).toBe("UserCount");
});

test("reciprocal many fields generate an explicit many-to-many join entity", () => {
  const source = `project shop
database sqlite
module Tags {
  entity Product {
    name: text
    tags: Tag[]
  }
  entity Tag {
    name: text unique
    products: Product[]
  }
}
`;
  const translated = translateQiyV1(source);
  expect(translated).toContain("entity products_tags {");
  expect(translated).toContain("field productId UUID;");
  expect(translated).toContain("field tagId UUID;");
  expect(translated).toContain("relation products_tagsProduct products_tags productId products id one;");
  expect(translated).toContain("relation products_tagsTag products_tags tagId tags id one;");
  const explanation = explainQiySource(source);
  expect(explanation.relations).toHaveLength(2);
  expect(explanation.entities.some((entity) => entity.name === "products_tags")).toBe(true);
});

test("v1 preview rejects unsupported constructs with actionable errors", () => {
  expect(() => translateQiyV1("project x\nmodule M {\n entity A {\n lines: Missing[]\n }\n}\n")).toThrow(/not declared/);
  expect(() => translateQiyV1("project x\ninclude \"a.qiy\";\n")).toThrow(/include is not supported/);
  expect(() => translateQiyV1("database sqlite\n")).toThrow(/missing `project/);
  expect(() => translateQiyV1("project x\nentity A {\n name: text bogus\n}\n")).toThrow(/unsupported field modifier/);
  expect(() => translateQiyV1("project x\nentity A {\n name: text\n}\nentity A {\n x: text\n}\n")).toThrow(/Duplicate entity/);
});

test("v1 entry files support includes of v1 fragments", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-v1-include-"));
  writeFileSync(join(root, "app.qiy"), `project shop
database sqlite
include "modules/catalog.qiy";
`);
  mkdirSync(join(root, "modules"), { recursive: true });
  writeFileSync(join(root, "modules/catalog.qiy"), `module Catalog {
  entity Product {
    name: text
    price: decimal(12, 2) nullable
  }
}
`);
  const explanation = await explainQiyFile(join(root, "app.qiy"));
  expect(explanation.entities.map((entity) => entity.name)).toEqual(["products"]);
});

test("qiy add entity/field supports v1 projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-v1-add-"));
  writeFileSync(join(root, "qiy.project.json"), JSON.stringify({ formatVersion: 1, name: "v1-shop", template: "minimal", model: "app.qiy", output: "admin" }));
  writeFileSync(join(root, "app.qiy"), "project v1-shop\ndatabase sqlite\n\nentity products {\n  name: text\n}\n");
  await addEntity("suppliers", { cwd: root, fields: ["name:Text"] });
  await addField("suppliers", "phone:Text", { cwd: root, nullable: true });
  const source = readFileSync(join(root, "app.qiy"), "utf8");
  expect(source).toContain("entity suppliers {");
  expect(source).toContain("name: text");
  expect(source).toContain("phone: text nullable");
  const explanation = await explainQiyFile(join(root, "app.qiy"));
  expect(explanation.entities.map((entity) => entity.name)).toContain("suppliers");
  await addModule("sales", { cwd: root });
  await addFeature("apiDocs", { cwd: root });
  const updated = readFileSync(join(root, "app.qiy"), "utf8");
  expect(updated).toContain('include "modules/10-sales.qiy";');
  expect(updated).toContain("features {");
  expect(updated).toContain("apiDocs true;");
  await expect(explainQiyFile(join(root, "app.qiy"))).resolves.toBeDefined();
});
