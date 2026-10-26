/**
 * JSON Schema for the output of `qiy explain --json`. Kept in sync with
 * `QiyExplanation` by `tests/explain-schema.test.ts`; bump `formatVersion` when
 * making a breaking shape change.
 */
export const QIY_EXPLANATION_FORMAT_VERSION = 1;

export const qiyExplanationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ai-nodev.github.io/qiy/schema/qiy-explanation-1.json",
  title: "Qiy model explanation",
  description: "Normalized, read-only summary of a .qiy model produced by `qiy explain --json`.",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "sourceFile", "valid", "application", "entities", "relations", "enums", "permissions", "dataflows", "actions", "charts", "counts"],
  properties: {
    formatVersion: { const: QIY_EXPLANATION_FORMAT_VERSION },
    sourceFile: { type: "string", minLength: 1 },
    valid: { const: true },
    application: {
      type: "object",
      additionalProperties: false,
      required: ["name", "mode", "database", "extensions"],
      properties: {
        name: { type: "string", minLength: 1 },
        comment: { type: "string" },
        mode: { enum: ["standalone", "integration"] },
        database: { enum: ["sqlite", "postgresql", "mysql"] },
        extensions: { type: "array", items: { type: "string" } },
        apiClient: { enum: ["rest", "graphql"] },
        storageProvider: { enum: ["local", "s3"] },
        features: {
          type: "object",
          additionalProperties: false,
          properties: { overview: { type: "boolean" }, apiDocs: { type: "boolean" }, apiKeys: { type: "boolean" } },
        },
        auth: {
          type: "object",
          additionalProperties: false,
          required: ["userEntity"],
          properties: {
            provider: { type: "string" },
            providers: { type: "array", items: { type: "string" } },
            local: { type: "boolean" },
            userEntity: { type: "string" },
          },
        },
        realtime: {
          type: "object",
          additionalProperties: false,
          required: ["mode", "resources"],
          properties: { mode: { type: "string" }, resources: { type: "array", items: { type: "string" } } },
        },
        workspace: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            aliases: { type: "object", additionalProperties: { type: "string" } },
            packages: { type: "object", additionalProperties: { type: "string" } },
          },
        },
        ui: {
          type: "object",
          additionalProperties: false,
          properties: {
            theme: { type: "string" },
            themes: { type: "array", items: { type: "string" } },
            colorMode: { type: "string" },
          },
        },
      },
    },
    entities: { type: "array", items: { $ref: "#/$defs/entity" } },
    relations: { type: "array", items: { $ref: "#/$defs/relation" } },
    enums: { type: "array", items: { $ref: "#/$defs/enum" } },
    permissions: {
      type: "object",
      additionalProperties: false,
      required: ["fields", "groups", "verifications"],
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "value"],
            properties: { name: { type: "string" }, value: { type: "string" } },
          },
        },
        groups: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "members", "form"],
            properties: {
              name: { type: "string" },
              members: { type: "array", items: { type: "string" } },
              form: { enum: ["list", "union"] },
            },
          },
        },
        verifications: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "inputs"],
            properties: { name: { type: "string" }, inputs: { type: "array", items: { type: "string" } } },
          },
        },
      },
    },
    dataflows: { type: "array", items: { $ref: "#/$defs/dataflow" } },
    actions: { type: "array", items: { $ref: "#/$defs/action" } },
    charts: { type: "array", items: { $ref: "#/$defs/chart" } },
    counts: {
      type: "object",
      additionalProperties: false,
      required: ["entities", "fields", "relations", "enums", "dataflows", "actions", "permissionFields", "permissionGroups", "charts"],
      properties: {
        entities: { type: "integer", minimum: 0 },
        fields: { type: "integer", minimum: 0 },
        relations: { type: "integer", minimum: 0 },
        enums: { type: "integer", minimum: 0 },
        dataflows: { type: "integer", minimum: 0 },
        actions: { type: "integer", minimum: 0 },
        permissionFields: { type: "integer", minimum: 0 },
        permissionGroups: { type: "integer", minimum: 0 },
        charts: { type: "integer", minimum: 0 },
      },
    },
  },
  $defs: {
    entity: {
      type: "object",
      additionalProperties: false,
      required: ["name", "tableName", "fields", "indexes"],
      properties: {
        name: { type: "string" },
        tableName: { type: "string" },
        label: { type: "string" },
        singular: { type: "string" },
        plural: { type: "string" },
        display: { type: "string" },
        comment: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "type"],
            properties: {
              name: { type: "string" },
              columnName: { type: "string" },
              type: { type: "string" },
              nullable: { type: "boolean" },
              primaryKey: { type: "boolean" },
              unique: { type: "boolean" },
              enumName: { type: "string" },
              label: { type: "string" },
              icon: { type: "string" },
              generated: { enum: ["code", "uuid"] },
              codeTemplate: { type: "string" },
            },
          },
        },
        indexes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "columns"],
            properties: {
              name: { type: "string" },
              columns: { type: "array", items: { type: "string" } },
              unique: { type: "boolean" },
              method: { type: "string" },
            },
          },
        },
      },
    },
    relation: {
      type: "object",
      additionalProperties: false,
      required: ["name", "from", "fromField", "to", "toField", "cardinality"],
      properties: {
        name: { type: "string" },
        from: { type: "string" },
        fromField: { type: "string" },
        to: { type: "string" },
        toField: { type: "string" },
        cardinality: { type: "string" },
        onDelete: { type: "string" },
      },
    },
    enum: {
      type: "object",
      additionalProperties: false,
      required: ["name", "values"],
      properties: { name: { type: "string" }, values: { type: "array", items: { type: "string" } } },
    },
    dataflow: {
      type: "object",
      additionalProperties: false,
      required: ["name", "inputs", "steps"],
      properties: {
        name: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        permission: { type: "array", items: { type: "string" } },
        verification: { type: "string" },
        idempotency: { type: "boolean" },
        audit: { type: "string" },
        inputs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "type", "required"],
            properties: { name: { type: "string" }, type: { type: "string" }, required: { type: "boolean" } },
          },
        },
        steps: { type: "integer", minimum: 0 },
      },
    },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["name", "resource", "placements", "target"],
      properties: {
        name: { type: "string" },
        resource: { type: "string" },
        placements: { type: "array", items: { enum: ["list", "show"] } },
        batch: { type: "boolean" },
        target: { enum: ["dataflow", "navigate"] },
      },
    },
    chart: {
      type: "object",
      additionalProperties: false,
      required: ["name", "views"],
      properties: {
        name: { type: "string" },
        views: { type: "array", items: { enum: ["const", "pie", "bar", "line", "table"] } },
        title: { type: "string" },
      },
    },
  },
} as const;
