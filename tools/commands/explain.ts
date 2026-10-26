import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatedFieldsOf } from "../database-ir";
import { parseQiyProject, type QiyProject } from "../qiy-project";

/**
 * Machine-readable explanation of a `.qiy` model. `qiy explain --json` emits this
 * shape and `qiy schema` emits its JSON Schema, so agents and tools can inspect a
 * model without generating a project or scraping diagnostics.
 */
export interface QiyExplanation {
  formatVersion: 1;
  sourceFile: string;
  valid: true;
  application: {
    name: string;
    comment?: string;
    mode: "standalone" | "integration";
    database: string;
    extensions: string[];
    apiClient?: "rest" | "graphql";
    storageProvider?: "local" | "s3";
    features?: { overview?: boolean; apiDocs?: boolean; apiKeys?: boolean };
    auth?: { provider?: string; providers?: string[]; local?: boolean; userEntity: string };
    realtime?: { mode: string; resources: string[] };
    workspace?: { name?: string; aliases?: { server?: string; web?: string; deploy?: string }; packages?: { server?: string; web?: string } };
    ui?: { theme?: string; themes?: string[]; colorMode?: string };
  };
  entities: Array<{
    name: string;
    tableName: string;
    label?: string;
    singular?: string;
    plural?: string;
    display?: string;
    comment?: string;
    fields: Array<{
      name: string;
      columnName?: string;
      type: string;
      nullable?: boolean;
      primaryKey?: boolean;
      unique?: boolean;
      enumName?: string;
      label?: string;
      icon?: string;
      generated?: "code" | "uuid";
      codeTemplate?: string;
    }>;
    indexes: Array<{ name: string; columns: string[]; unique?: boolean; method?: string }>;
  }>;
  relations: Array<{ name: string; from: string; fromField: string; to: string; toField: string; cardinality: string; onDelete?: string }>;
  enums: Array<{ name: string; values: string[] }>;
  permissions: {
    fields: Array<{ name: string; value: string }>;
    groups: Array<{ name: string; members: string[]; form: string }>;
    verifications: Array<{ name: string; inputs: string[] }>;
  };
  dataflows: Array<{
    name: string;
    roles?: string[];
    permission?: string[];
    verification?: string;
    idempotency?: boolean;
    audit?: string;
    inputs: Array<{ name: string; type: string; required: boolean }>;
    steps: number;
  }>;
  actions: Array<{ name: string; resource: string; placements: string[]; batch?: boolean; target: string }>;
  charts: Array<{ name: string; views: string[]; title?: string }>;
  counts: {
    entities: number;
    fields: number;
    relations: number;
    enums: number;
    dataflows: number;
    actions: number;
    permissionFields: number;
    permissionGroups: number;
    charts: number;
  };
}

export function explainQiyProject(project: QiyProject, sourceFile: string): QiyExplanation {
  const relations = project.database.relations ?? [];
  const entities = project.database.entities.map((entity) => {
    const generated = new Map(generatedFieldsOf(entity, relations).map((field) => [field.field.name, field]));
    const indexes = (entity.indexes ?? []).map((index) => ({
      name: index.name,
      columns: index.columns.map((column) => column.fieldName),
      ...(index.unique ? { unique: true } : {}),
      ...(index.method ? { method: index.method } : {}),
    }));
    return {
      name: entity.name,
      tableName: entity.tableName,
      ...(entity.label ? { label: entity.label } : {}),
      ...(entity.singular ? { singular: entity.singular } : {}),
      ...(entity.plural ? { plural: entity.plural } : {}),
      ...(entity.display ? { display: entity.display } : {}),
      ...(entity.comment ? { comment: entity.comment } : {}),
      fields: entity.fields.map((field) => {
        const generatedField = generated.get(field.name);
        return {
          name: field.name,
          ...(field.columnName ? { columnName: field.columnName } : {}),
          type: field.type,
          ...(field.nullable ? { nullable: true } : {}),
          ...(field.primaryKey ? { primaryKey: true } : {}),
          ...(field.unique ? { unique: true } : {}),
          ...(field.enumName ? { enumName: field.enumName } : {}),
          ...(field.label ? { label: field.label } : {}),
          ...(field.icon ? { icon: field.icon } : {}),
          ...(generatedField ? { generated: generatedField.kind } : {}),
          ...(generatedField?.template ? { codeTemplate: generatedField.template } : {}),
        };
      }),
      indexes,
    };
  });

  const permissions = project.permissions;
  const charts = project.charts ?? [];
  return {
    formatVersion: 1,
    sourceFile,
    valid: true,
    application: {
      name: project.name,
      ...(project.comment ? { comment: project.comment } : {}),
      mode: project.mode ?? "standalone",
      database: project.database.dialect,
      extensions: project.database.extensions ?? [],
      ...(project.apiClient ? { apiClient: project.apiClient } : {}),
      ...(project.storageProvider ? { storageProvider: project.storageProvider } : {}),
      ...(project.features ? { features: project.features } : {}),
      ...(project.auth
        ? {
            auth: {
              ...(project.auth.provider ? { provider: project.auth.provider } : {}),
              ...(project.auth.providers ? { providers: project.auth.providers } : {}),
              ...(project.auth.local ? { local: true } : {}),
              userEntity: project.auth.userEntity,
            },
          }
        : {}),
      ...(project.realtime
        ? { realtime: { mode: project.realtime.mode, resources: project.realtime.resources.map((resource) => resource.resource) } }
        : {}),
      ...(project.workspace ? { workspace: project.workspace } : {}),
      ...(project.ui
        ? {
            ui: {
              ...(project.ui.theme ? { theme: project.ui.theme } : {}),
              ...(project.ui.themes ? { themes: project.ui.themes } : {}),
              ...(project.ui.colorMode ? { colorMode: project.ui.colorMode } : {}),
            },
          }
        : {}),
    },
    entities,
    relations: relations.map((relation) => ({
      name: relation.name,
      from: relation.fromEntity,
      fromField: relation.fromField,
      to: relation.toEntity,
      toField: relation.toField,
      cardinality: relation.cardinality,
      ...(relation.onDelete ? { onDelete: relation.onDelete } : {}),
    })),
    enums: (project.database.enums ?? []).map((item) => ({ name: item.name, values: item.values.map((value) => value.name) })),
    permissions: {
      fields: (permissions?.fields ?? []).map((field) => ({ name: field.name, value: field.value })),
      groups: (permissions?.groups ?? []).map((group) => ({ name: group.name, members: group.members, form: group.form })),
      verifications: (permissions?.verifications ?? []).map((verification) => ({
        name: verification.name,
        inputs: verification.inputs.map((input) => `${input.name}: ${input.type}`),
      })),
    },
    dataflows: (project.dataflows ?? []).map((flow) => ({
      name: flow.name,
      ...(flow.roles ? { roles: flow.roles } : {}),
      ...(flow.permission ? { permission: flow.permission } : {}),
      ...(flow.verification ? { verification: flow.verification } : {}),
      ...(flow.idempotency ? { idempotency: flow.idempotency.required } : {}),
      ...(flow.audit ? { audit: flow.audit } : {}),
      inputs: flow.input.map((input) => ({ name: input.name, type: input.type, required: input.required })),
      steps: flow.steps.length,
    })),
    actions: (project.actions ?? []).map((action) => ({
      name: action.name,
      resource: action.resource,
      placements: action.placements,
      ...(action.batch ? { batch: true } : {}),
      target: action.target.kind,
    })),
    charts: charts.map((chart) => ({
      name: chart.name,
      views: chart.views.map((view) => view.kind),
      ...(chart.title ? { title: chart.title } : {}),
    })),
    counts: {
      entities: entities.length,
      fields: entities.reduce((total, entity) => total + entity.fields.length, 0),
      relations: relations.length,
      enums: project.database.enums?.length ?? 0,
      dataflows: project.dataflows?.length ?? 0,
      actions: project.actions?.length ?? 0,
      permissionFields: permissions?.fields.length ?? 0,
      permissionGroups: permissions?.groups.length ?? 0,
      charts: charts.length,
    },
  };
}

export function explainQiySource(source: string, sourceFile = "<model>"): QiyExplanation {
  return explainQiyProject(parseQiyProject(source), sourceFile);
}

export function explainQiyFile(sourcePath: string): QiyExplanation {
  const file = resolve(sourcePath);
  return explainQiySource(readFileSync(file, "utf8"), sourcePath);
}

export function formatQiyExplanation(explanation: QiyExplanation): string {
  const { application, counts } = explanation;
  const lines = [
    `${application.name} (${application.mode}, ${application.database})`,
    `source: ${explanation.sourceFile}`,
    `entities: ${counts.entities}, fields: ${counts.fields}, relations: ${counts.relations}, enums: ${counts.enums}`,
    `dataflows: ${counts.dataflows}, actions: ${counts.actions}, charts: ${counts.charts}`,
    `permissions: ${counts.permissionFields} fields, ${counts.permissionGroups} groups`,
  ];
  for (const entity of explanation.entities) {
    const flags = [
      entity.fields.some((field) => field.primaryKey) ? "pk" : "",
      entity.fields.some((field) => field.generated) ? "generated" : "",
    ].filter(Boolean);
    lines.push(`- entity ${entity.name} (${entity.tableName})${flags.length ? ` [${flags.join(", ")}]` : ""}`);
  }
  for (const flow of explanation.dataflows) lines.push(`- dataflow ${flow.name} (${flow.steps} steps, ${flow.inputs.length} inputs)`);
  for (const action of explanation.actions) lines.push(`- action ${action.name} → ${action.target}`);
  return `${lines.join("\n")}\n`;
}
