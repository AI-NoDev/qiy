import { describe, expect, test } from "bun:test";
import { validateDatabaseIR, validateDisplayTemplate, type EntityIR } from "../tools/database-ir";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const entity = (extra: Partial<EntityIR> = {}): EntityIR => ({
  name: "customers",
  tableName: "customers",
  fields: [
    { name: "id", type: "UUID", primaryKey: true },
    { name: "code", type: "Text", unique: true },
    { name: "name", type: "Text" },
    { name: "status", type: "Text", enumName: "activeState" },
    { name: "attachment", type: "File", nullable: true },
    { name: "tags", type: "Files", nullable: true },
  ],
  ...extra,
});

describe("entity display annotations", () => {
  test("parses and serializes every display annotation", () => {
    const project = parseQiyProject(`qiy v0; application display {
      database sqlite {}
      enum activeState { value active; value inactive; }
      entity customers @label("Customers") @icon(TeamOutlined) @singular("Customer") @plural("Customers") @display("{$.name}") @tableDisplay("{$.code} · {$.name}") @relationDetail("<b>{$.name}</b></br>状态：{$.status}") {
        field id UUID @id;
        field code Text @unique;
        field name Text;
        field status activeState;
      }
    }`);
    const customers = project.database.entities[0]!;
    expect(customers.singular).toBe("Customer");
    expect(customers.plural).toBe("Customers");
    expect(customers.display).toBe("{$.name}");
    expect(customers.tableDisplay).toBe("{$.code} · {$.name}");
    expect(customers.relationDetail).toBe("<b>{$.name}</b></br>状态：{$.status}");
    // Serializer keeps every annotation and re-parses to the same IR.
    const source = serializeQiyProject(project);
    for (const annotation of ['@singular("Customer")', '@plural("Customers")', '@display("{$.name}")', '@tableDisplay("{$.code} · {$.name}")', '@relationDetail("<b>{$.name}</b></br>状态：{$.status}")']) {
      expect(source).toContain(annotation);
    }
    expect(parseQiyProject(source).database).toEqual(project.database);
    // A model without the annotations stays untouched by the serializer.
    const plain = parseQiyProject(`qiy v0; application plain { database sqlite {} entity notes { field id UUID @id; field body Text; } }`);
    expect(plain.database.entities[0]!.singular).toBeUndefined();
    expect(serializeQiyProject(plain)).not.toContain("@display(");
  });

  test("rejects duplicate annotations", () => {
    expect(() => parseQiyProject(`qiy v0; application display { database sqlite {} entity customers @display("{$.id}") @display("{$.id}") { field id UUID @id; } }`)).toThrow("duplicate @display annotation");
    expect(() => parseQiyProject(`qiy v0; application display { database sqlite {} entity customers @singular("A") @singular("B") { field id UUID @id; } }`)).toThrow("duplicate @singular annotation");
  });

  test("accepts the documented tag whitelist, Django-style </br> and enum placeholders", () => {
    const template = '<b>{$.name}</b> <strong>{$.code}</strong> <i>i</i> <em>e</em> <span>s</span> <small>m</small><p>{$.status}</p><div>d</div></br><br><br/>';
    expect(validateDisplayTemplate(template, entity(), "display")).toEqual([]);
    expect(validateDisplayTemplate("{$.status}", entity(), "relationDetail")).toEqual([]);
  });

  test("rejects unknown fields, non-scalar fields and foreign keys", () => {
    expect(validateDisplayTemplate("{$.missing}", entity(), "display")).toEqual(["customers: @display template references unknown field missing"]);
    expect(validateDisplayTemplate("{$.attachment}", entity(), "display")[0]).toContain("cannot interpolate File field attachment");
    expect(validateDisplayTemplate("{$.tags}", entity(), "tableDisplay")[0]).toContain("cannot interpolate Files field tags");
    const withForeignKey = entity({ fields: [...entity().fields, { name: "customerId", type: "UUID" }] });
    expect(validateDisplayTemplate("{$.customerId}", withForeignKey, "display", { relationFields: new Set(["customers.customerId"]) })[0]).toContain("cannot interpolate foreign key field customerId");
  });

  test("rejects malformed markup and placeholder syntax with clear errors", () => {
    expect(validateDisplayTemplate("", entity(), "display")).toEqual(["customers: @display template must be a non-empty string"]);
    const cases: Array<[string, string]> = [
      ["{name}", "malformed placeholder"],
      ["{.name}", "malformed placeholder"],
      ["{$.name", "malformed placeholder"],
      ["<script>alert(1)</script>", "unsupported tag <script>"],
      ['<b class="x">{$.name}</b>', "unterminated tag"],
      ["<b>{$.name}", "unclosed <b> tag"],
      ["</b>{$.name}", "closing tag </b> has no matching opening tag"],
      ["<b><i>{$.name}</b></i>", "closing tag </b> does not match <i>"],
      ["<B>{$.name}</B>", "tag <B> must be lowercase"],
      ["<span/>{$.name}", "does not support self-closing <span/>"],
      ["0 > 1 {$.name}", 'stray ">"'],
      ["<img>{$.name}</img>", "unsupported tag <img>"],
    ];
    for (const [template, message] of cases) {
      expect(validateDisplayTemplate(template, entity(), "display").join("\n")).toContain(message);
    }
  });

  test("validateDatabaseIR enforces the relation-aware template rules", () => {
    const database = {
      dialect: "sqlite" as const,
      extensions: [],
      entities: [entity(), { name: "orders", tableName: "orders", fields: [{ name: "id", type: "UUID" as const, primaryKey: true }, { name: "customerId", type: "UUID" as const }] }],
      enums: [{ name: "activeState", values: [{ name: "active" }, { name: "inactive" }] }],
      relations: [{ name: "orderCustomer", fromEntity: "orders", fromField: "customerId", toEntity: "customers", toField: "id", cardinality: "one" as const }],
    };
    expect(validateDatabaseIR(database)).toEqual([]);
    const invalid = structuredClone(database);
    invalid.entities[1]!.display = "{$.customerId}";
    expect(validateDatabaseIR(invalid).join("\n")).toContain("cannot interpolate foreign key field customerId");
  });

  test("generates defaults and inherits table/relation templates from @display", () => {
    const project = parseQiyProject(`qiy v0; application display {
      database sqlite {}
      entity customers @label("Customers") {
        field id UUID @id;
        field code Text @unique;
        field name Text;
      }
      entity notes @display("{$.body}") {
        field id UUID @id;
        field body Text;
      }
    }`);
    const files = generateWeb(project.database, project);
    const resources = files["web/app/resources.ts"]!;
    // No annotations: the natural label field becomes the display fallback.
    expect(resources).toContain('"singular": "Customers"');
    expect(resources).toContain('"displayTemplate": "{$.name}"');
    expect(resources).toContain('"tableDisplayTemplate": "{$.name}"');
    expect(resources).toContain('"relationDetailTemplate": "{$.name}"');
    // @display is inherited by the table cell and the drawer body.
    expect(resources.match(/"relationDetailTemplate": "\{\$\.body\}"/g)).toHaveLength(1);
  });
});
