import { deliveryTargetsByEvent, isDataflowCronJob, renderDeliveryModule, renderDeliverySchema, renderDeliveryTest, renderJobLeaseModule, renderJobLeaseSchema, renderScheduledDataflowModule, renderScheduledDataflowTest, usesDeliveries } from "./delivery";
import type { DatabaseIR, EntityIR } from "./database-ir";
import { manyRelations } from "./database-ir";
import { renderLinkedRepository, renderRelationLinksModule, renderRepositoryLinks, repositoryLinkImports, validateRelationLinkScopes } from "./generate-relation-links";
import { renderViewRoutes } from "./generate-view-routes";
import type { QiyPolicyExpression, QiyResourceRestriction, QiyRowPredicate, QiyFieldMask } from "./qiy-project";
import { authHasLocal, authIsHybrid, authOAuthProviders, authProviderSubjectField, authUsesProviderChooser } from "./qiy-project";
import { isPermissionModelEmpty } from "./permissions";
import { renderRolesModule, roleContext, withDefaultCommandRoles } from "./roles";
import { renderAppTemplate } from "./admin-template";
import { generatedFieldsOf, validateDatabaseIR } from "./database-ir";
import { generateDrizzlePostgres } from "./drizzle-pg";
import { generateDrizzleMysql } from "./drizzle-mysql";
import { generateDrizzleSqlite } from "./drizzle-sqlite";
import { generateAudit } from "./generate-audit";
import { generatedFieldSpecs, renderGeneratedValuesModule, renderGeneratedValuesTest, usesGeneratedValues } from "./generate-values";
import { entityFieldRules, renderFieldRulesModule, ruleSample } from "./field-rules";
import { generatedDocumentation } from "./generated-documentation";
import { resolveScopeTree, renderScopeTreeHelper, temporalFieldsOf, modelName, userClaimFields, renderUserClaimLines, type ServerOptions } from "./server/shared";
import { renderApiKeySchema, renderApiKeyHashModule, renderApiKeyRoutesModule, renderDocsModule, renderDocsRoutesModule, renderDocsTestModule, renderApiKeyTestModule } from "./server/api-keys-docs";
import { renderSessionRevocationSchema } from "./server/auth";
import { graphqlName, dataflowGraphqlName, renderGraphQL, renderGraphQLAdapter, renderGraphQLTest, renderGraphQLListOptionsTest } from "./server/graphql";
import { renderSqliteVersionTest, renderSqliteScopeTest, renderSqliteRealtimeOutboxTest } from "./server/sqlite-tests";
import { renderDataflowIdempotencySchema, renderDataflowOutboxSchema, renderDataflowCallContracts, renderDataflowCallExtensions, renderDataflowRoutes, renderSqliteDataflowTest, renderQiyScenarioTest } from "./server/dataflows";
import { rowPolicyFree, renderDataScopeTest, previewRepository, renderPolicyModule } from "./server/permissions";
import { renderRealtimeOutboxSchema, renderExportJobsModule, renderSavedViewsModule, renderSavedViewsTest, renderImportJobsModule, renderRealtime, maskedRealtimeFields } from "./server/jobs-realtime";
import { renderComputedRepository, renderRepositoryMethods } from "./server/repository";
import { renderRoutes, renderRouteTest } from "./server/routes";
import { renderDatabaseOperationFiles } from "./server/database-ops";
import { addAuthFiles } from "./server/auth-files";

/**
 * Date and Time are text contracts shared by REST, GraphQL and CSV:
 *   Date -> `YYYY-MM-DD`, Time -> `HH:mm:ss` (seconds default to `00`).
 * DateTime keeps the existing ISO date-time string / timestamp column behaviour.
 * TypeBox's registered `date` format is not strict and has no local-time format,
 * so the generated server validates these two types explicitly.
 */
function renderTemporalModule(): string {
  return `export type QiyTemporalFieldType = "Date" | "Time";

export class QiyTemporalValueError extends Error {
  readonly field: string;
  readonly type: QiyTemporalFieldType;

  constructor(field: string, type: QiyTemporalFieldType, value: unknown) {
    const expected = type === "Date" ? "YYYY-MM-DD" : "HH:mm:ss";
    super("Invalid " + type + " value for " + field + " (" + JSON.stringify(value ?? null) + "); expected " + expected);
    this.name = "QiyTemporalValueError";
    this.field = field;
    this.type = type;
  }
}

/** A calendar-valid date in the stored \`YYYY-MM-DD\` form. */
export function isValidDateValue(value: string): boolean {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Normalizes \`HH:mm\` or \`HH:mm:ss\` to the stored \`HH:mm:ss\` form; undefined when invalid. */
export function normalizeTimeValue(value: string): string | undefined {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(value);
  return match ? match[1] + ":" + match[2] + ":" + (match[3] ?? "00") : undefined;
}

/**
 * Validates and normalizes the declared Date/Time fields of one write payload.
 * Absent, null and empty values are left untouched so nullable fields and PATCH
 * bodies keep working; an invalid value throws QiyTemporalValueError (400).
 */
export function normalizeTemporalValues<T extends Record<string, unknown>>(values: T, types: Record<string, QiyTemporalFieldType>): T {
  let next: Record<string, unknown> | undefined;
  for (const [field, type] of Object.entries(types)) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") throw new QiyTemporalValueError(field, type, value);
    if (type === "Date") {
      if (!isValidDateValue(value)) throw new QiyTemporalValueError(field, type, value);
      continue;
    }
    const normalized = normalizeTimeValue(value);
    if (!normalized) throw new QiyTemporalValueError(field, type, value);
    if (normalized !== value) {
      next ??= { ...values };
      next[field] = normalized;
    }
  }
  return (next ?? values) as T;
}
`;
}

function renderConcurrencyModule(): string {
  return `/** An update carried a stale @version counter: someone else changed the record first. */
export class QiyVersionConflict extends Error {
  readonly resource: string;
  readonly id: string;
  readonly errorKey = "version.conflict";
  /** graphql-js copies an original error's extensions into the GraphQL response. */
  readonly extensions: { status: 409; errorKey: string };

  constructor(resource: string, id: string) {
    super("The record was changed by someone else; reload it and try again");
    this.name = "QiyVersionConflict";
    this.resource = resource;
    this.id = id;
    this.extensions = { status: 409, errorKey: this.errorKey };
  }
}
`;
}

export function generateServer(database: DatabaseIR, options: ServerOptions = {}): Record<string, string> {
  if (options.realtime && !options.auth) throw new Error("Realtime requires generated authentication");
  const roles = roleContext(options.auth);
  if (options.dataflows) options = { ...options, dataflows: withDefaultCommandRoles(options.dataflows, options.auth) };
  const errors = [...validateDatabaseIR(database), ...validateRelationLinkScopes(database, options.scopes ?? [])];
  if (errors.length) throw new Error(errors.join("\n"));
  const uploadField = database.entities.flatMap((entity) => entity.fields.filter((field) => field.type === "File").map((field) => ({ entity, field }))).at(0);
  const graphqlTypes = new Set(["String", "Int", "Float", "Boolean", "ID", "Query", "Mutation", "QiyFilterInput", "QiyDistribution", "QiyTrend"]);
  const graphqlQueries = new Set<string>();
  const graphqlMutations = new Set<string>();
  if (database.entities.length === 0) errors.push("GraphQL: at least one entity is required");
  const validGraphqlName = (name: string) => /^[_A-Za-z][_0-9A-Za-z]*$/.test(name) && !name.startsWith("__");
  const registerGraphqlType = (name: string) => {
    if (!validGraphqlName(name) || graphqlTypes.has(name)) errors.push(`GraphQL: invalid or duplicate type name ${name}`);
    graphqlTypes.add(name);
  };
  for (const enumeration of database.enums ?? []) {
    registerGraphqlType(graphqlName(enumeration.name));
    for (const value of enumeration.values ?? []) {
      if (!validGraphqlName(value.name) || ["true", "false", "null"].includes(value.name)) errors.push(`GraphQL: invalid enum value ${enumeration.name}.${value.name}`);
    }
  }
  for (const entity of database.entities) {
    const name = modelName(entity);
    for (const type of [name, `${name}Page`, `${name}CreateInput`, `${name}UpdateInput`]) registerGraphqlType(type);
    for (const query of [entity.name, `${entity.name}ById`, `${entity.name}Distribution`, `${entity.name}Trend`]) {
      if (!validGraphqlName(query) || graphqlQueries.has(query)) errors.push(`GraphQL: invalid or duplicate query name ${query}`);
      graphqlQueries.add(query);
    }
    for (const field of entity.fields) {
      if (!validGraphqlName(field.name)) errors.push(`GraphQL: invalid field name ${entity.name}.${field.name}`);
    }
    for (const mutation of [`create${name}`, `update${name}`, `delete${name}`, `delete${name}Many`]) {
      if (graphqlMutations.has(mutation)) errors.push(`GraphQL: duplicate mutation name ${mutation}`);
      graphqlMutations.add(mutation);
    }
    if (!entity.fields.some((field) => !field.primaryKey)) errors.push(`GraphQL: ${entity.name} requires a non-primary field for create/update inputs`);
  }
  for (const flow of options.dataflows ?? []) {
    const name = dataflowGraphqlName(flow.name);
    if (flow.input.length > 0) registerGraphqlType(`${name}CommandInput`);
    const mutation = `run${name}`;
    if (!validGraphqlName(mutation) || graphqlMutations.has(mutation)) errors.push(`GraphQL: invalid or duplicate mutation name ${mutation}`);
    graphqlMutations.add(mutation);
    if ((options.actions ?? []).some((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name)) {
      const batchMutation = `${mutation}Batch`;
      if (!validGraphqlName(batchMutation) || graphqlMutations.has(batchMutation)) errors.push(`GraphQL: invalid or duplicate mutation name ${batchMutation}`);
      graphqlMutations.add(batchMutation);
    }
    for (const field of flow.input) {
      if (!validGraphqlName(field.name)) errors.push(`GraphQL: invalid dataflow input name ${flow.name}.${field.name}`);
    }
  }
  if (database.entities.some((entity) => entity.fields.some((field) => field.type === "Vector")) && database.dialect !== "postgresql") errors.push("Vector fields require PostgreSQL with pgvector");
  for (const entity of database.entities) {
    const keys = entity.fields.filter((field) => field.primaryKey);
    if (keys.length !== 1 || keys[0]?.name !== "id" || keys[0]?.type !== "UUID") {
      errors.push(`${entity.name}: V0 CRUD requires exactly one UUID primary key named id`);
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(entity.tableName)) errors.push(`${entity.name}: route path must be lowercase and URL-safe`);
  }
  const auth = options.auth;
  // Authentication modes are derived once so every generation branch agrees:
  // local-only (password), hybrid (password + OAuth), legacy single OAuth and
  // multi-provider OAuth.
  const hasLocalAuth = Boolean(auth && authHasLocal(auth));
  const oidcProviders = auth ? authOAuthProviders(auth) : [];
  const hasOidcAuth = oidcProviders.length > 0;
  const hybridAuth = Boolean(auth && authIsHybrid(auth));
  const providerChooserAuth = Boolean(auth && authUsesProviderChooser(auth));
  const multiProviderAuth = Boolean(auth && providerChooserAuth && !hybridAuth);
  const singleOidcAuth = Boolean(auth && hasOidcAuth && !providerChooserAuth);
  // Permission declarations need generated authentication to resolve a principal.
  const permissions = options.permissions && !isPermissionModelEmpty(options.permissions) ? options.permissions : undefined;
  if (permissions && !auth) errors.push("Permission declarations require a generated auth block");
  const features = options.features ?? { overview: true, apiDocs: false, apiKeys: false };
  const apiDocsEnabled = Boolean(features.apiDocs);
  const apiKeysEnabled = Boolean(features.apiKeys);
  // The 閸旂喕鍏橀幀鏄忣潔 page is generated when it is enabled and at least one docs API
  // feature exists; its model endpoint must exist for that page to load.
  const overviewRequested = features.overview !== false && (apiDocsEnabled || apiKeysEnabled);
  const docsModelEnabled = apiDocsEnabled || overviewRequested;
  if (apiKeysEnabled && !auth) errors.push("features apiKeys requires a generated auth block");
  if (apiKeysEnabled && !database.entities.some((entity) => entity.name === auth!.userEntity)) errors.push(`features apiKeys requires the auth user entity ${auth!.userEntity}`);
  const userEntityForScopes = auth ? database.entities.find((entity) => entity.name === auth.userEntity) : undefined;
  for (const mapping of auth?.claimFields ?? []) {
    if (userEntityForScopes && !userEntityForScopes.fields.some((field) => field.name === mapping.field)) errors.push(`Auth claim ${mapping.claim}: unknown field ${userEntityForScopes.name}.${mapping.field}`);
  }
  const apiKeyScopeClaimLines = renderUserClaimLines(userClaimFields(auth, userEntityForScopes, options.scopes), "user");
  if (permissions && permissions.fields.length === 0) errors.push("Permission declarations require at least one permission field");
  if (permissions?.claims?.length && oidcProviders.length === 0) errors.push("Permission claim sources require at least one OAuth/OIDC provider");
  for (const claim of permissions?.claims ?? []) {
    if (!oidcProviders.includes(claim.provider as (typeof oidcProviders)[number])) errors.push(`Permission claim source ${claim.provider}: provider is not configured`);
  }
  if (permissions?.database) {
    const userEntity = database.entities.find((entity) => entity.name === auth?.userEntity);
    const field = userEntity?.fields.find((candidate) => candidate.name === permissions.database!.field);
    if (!userEntity) errors.push(`Permission database source: unknown auth user entity ${auth?.userEntity ?? "(missing)"}`);
    else if (!field) errors.push(`Permission database source: unknown field ${userEntity.name}.${permissions.database.field}`);
    else if (field.type !== "Text") errors.push(`Permission database source: ${userEntity.name}.${permissions.database.field} must be a Text column`);
  }
  const realtimeResources = new Set<string>();
  for (const subscription of options.realtime?.resources ?? []) {
    const entity = database.entities.find((candidate) => candidate.name === subscription.resource || candidate.tableName === subscription.resource);
    if (!entity) errors.push(`Realtime: unknown resource ${subscription.resource}`);
    else if (realtimeResources.has(entity.tableName)) errors.push(`Realtime: duplicate resource ${entity.tableName}`);
    else realtimeResources.add(entity.tableName);
    if (!subscription.events.length || new Set(subscription.events).size !== subscription.events.length) errors.push(`Realtime ${subscription.resource}: events must be unique and non-empty`);
    if (!subscription.roles.length || new Set(subscription.roles).size !== subscription.roles.length) errors.push(`Realtime ${subscription.resource}: roles must be unique and non-empty`);
    // Row predicates cannot be evaluated per subscriber on one shared channel, so
    // publishing would hand every subscriber records they cannot read over HTTP.
    const restrictedRows = (options.restrictions ?? []).find((restriction) => restriction.resource === entity?.name)?.rows ?? [];
    if (restrictedRows.length) errors.push(`Realtime ${subscription.resource}: restrict row predicates cannot be enforced on a shared channel; remove the realtime events or the row predicates`);
    if (subscription.claim) {
      const field = entity?.fields.find((candidate) => candidate.name === subscription.claim!.field);
      // The segmented channel name is built from the value, so it must always exist.
      if (!field) errors.push(`Realtime ${subscription.resource}: unknown claim field ${subscription.claim.field}`);
      else if (field.nullable) errors.push(`Realtime ${subscription.resource}: claim field ${field.name} must be non-nullable`);
      else if (!["Text", "Integer"].includes(field.type)) errors.push(`Realtime ${subscription.resource}: claim field ${field.name} must be Text or Integer`);
      if (restrictedRows.length) errors.push(`Realtime ${subscription.resource}: a claim-scoped channel already isolates rows; remove the restrict row predicates`);
    }
  }
  const cronNames = new Set<string>();
  for (const job of options.elysiaPlugins?.cron ?? []) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(job.name)) errors.push(`Cron: invalid job name ${job.name}`);
    if (cronNames.has(job.name)) errors.push(`Cron: duplicate job name ${job.name}`);
    cronNames.add(job.name);
    if (!/^\S+(?:\s+\S+){4,5}$/.test(job.pattern)) errors.push(`Cron ${job.name}: pattern must have 5 or 6 fields`);
    if ("task" in job && job.task !== "cleanupMissingAttachments") errors.push(`Cron ${job.name}: unsupported task ${job.task}`);
    if (isDataflowCronJob(job) && !(options.dataflows ?? []).some((flow) => flow.name === job.dataflow)) errors.push(`Cron ${job.name}: unknown dataflow ${job.dataflow}`);
  }
  const staticConfig = options.elysiaPlugins?.static;
  if (staticConfig) {
    if (!/^public(?:\/[a-zA-Z0-9_-]+)*$/.test(staticConfig.assets)) errors.push("Elysia Static: assets must be public or a subdirectory of public");
    if (!/^\/[a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*$/.test(staticConfig.prefix)
      || ["api", "graphql", "assets"].includes(staticConfig.prefix.split("/")[1] ?? "")) {
      errors.push("Elysia Static: prefix must be a dedicated path outside /api, /graphql and /assets");
    }
  }
  const scopedResources = new Set<string>();
  for (const scope of options.scopes ?? []) {
    const entity = database.entities.find((item) => item.tableName === scope.resource || item.name === scope.resource);
    if (!entity) errors.push(`Scope: unknown resource ${scope.resource}`);
    if (entity && scopedResources.has(entity.name)) errors.push(`Scope: duplicate resource ${entity.name}`);
    if (entity) scopedResources.add(entity.name);
    const field = entity?.fields.find((item) => item.name === scope.field);
    if (!field) errors.push(`Scope ${scope.resource}.${scope.field}: unknown field`);
    if (field && !["UUID", "Text"].includes(field.type)) errors.push(`Scope ${scope.resource}.${scope.field}: field must be UUID or Text`);
    if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(scope.claim)) errors.push(`Scope ${scope.resource}.${scope.field}: invalid claim`);
    if (scope.tree) {
      const treeEntity = database.entities.find((item) => item.name === scope.tree!.entity || item.tableName === scope.tree!.entity);
      if (!treeEntity) errors.push(`Scope ${scope.resource}.${scope.field}: unknown tree entity ${scope.tree.entity}`);
      else {
        const parentField = treeEntity.fields.find((item) => item.name === scope.tree!.parentField);
        if (!parentField) errors.push(`Scope ${scope.resource}.${scope.field}: tree entity ${treeEntity.name} has no field ${scope.tree.parentField}`);
        else if (!["UUID", "Text"].includes(parentField.type)) errors.push(`Scope ${scope.resource}.${scope.field}: tree parent field ${parentField.name} must be UUID or Text`);
        const treeId = treeEntity.fields.find((item) => item.primaryKey);
        // The claim value, the tree id and the scoped column must be comparable text.
        if (field && treeId && field.type !== treeId.type) errors.push(`Scope ${scope.resource}.${scope.field}: field ${field.name} (${field.type}) must match tree id ${treeEntity.name}.${treeId.name} (${treeId.type})`);
        if (field && parentField && field.type !== parentField.type) errors.push(`Scope ${scope.resource}.${scope.field}: field ${field.name} (${field.type}) must match tree parent ${treeEntity.name}.${parentField.name} (${parentField.type})`);
      }
    }
  }
  const restrictedResources = new Set<string>();
  const normalizedRestrictions: QiyResourceRestriction[] = [];
  for (const restriction of options.restrictions ?? []) {
    const entity = database.entities.find((item) => item.tableName === restriction.resource || item.name === restriction.resource);
    if (!entity) {
      errors.push(`Restrict: unknown resource ${restriction.resource}`);
      continue;
    }
    if (restrictedResources.has(entity.name)) errors.push(`Restrict: duplicate resource ${entity.name}`);
    restrictedResources.add(entity.name);
    if (restriction.roles && (new Set(restriction.roles).size !== restriction.roles.length || !restriction.roles.length)) {
      errors.push(`Restrict ${entity.name}: roles must be unique and non-empty`);
    }
    for (const role of restriction.roles ?? []) {
      if (!roles.names.includes(role)) errors.push(`Restrict ${entity.name}: unknown role ${role}; declared roles are ${roles.names.join(", ")}`);
    }
    const rows: QiyRowPredicate[] = [];
    const groups: QiyRowPredicate[][] = [];
    /** Validates one row predicate; the flag keeps group duplicates local to their group. */
    const normalizeRow = (row: QiyRowPredicate, siblings: QiyRowPredicate[]) => {
      const field = entity.fields.find((item) => item.name === row.field);
      if (!field) { errors.push(`Restrict ${entity.name}: unknown row condition field ${row.field}`); return; }
      if (field.primaryKey) errors.push(`Restrict ${entity.name}: row conditions cannot target primary key ${row.field}`);
      if (siblings.some((candidate) => candidate.field === row.field)) errors.push(`Restrict ${entity.name}: duplicate row condition on ${row.field}`);
      if (row.source === "claim") {
        if (!row.claim || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(row.claim)) errors.push(`Restrict ${entity.name}: invalid claim ${row.claim ?? "<missing>"}`);
        if (row.operator !== "==") errors.push(`Restrict ${entity.name}: claim row conditions support == only`);
        if (field.nullable) errors.push(`Restrict ${entity.name}: row condition on nullable field ${row.field} is not supported`);
      } else {
        if (!row.values?.length) errors.push(`Restrict ${entity.name}: row condition on ${row.field} requires at least one value`);
        if (new Set(row.values ?? []).size !== (row.values ?? []).length) errors.push(`Restrict ${entity.name}: duplicate row value on ${row.field}`);
        if (!["==", "!=", "in", "notIn"].includes(row.operator)) errors.push(`Restrict ${entity.name}: unsupported row operator ${row.operator}`);
        if ((row.operator === "==" || row.operator === "!=") && (row.values ?? []).length !== 1) errors.push(`Restrict ${entity.name}: ${row.operator} on ${row.field} requires exactly one value`);
        const comparable = ["Text", "Integer", "Decimal", "Money", "Date", "Time", "DateTime"].includes(field.type) || Boolean(field.enumName);
        if (!comparable) errors.push(`Restrict ${entity.name}: value comparisons require Text, enum, Integer, Decimal, Money, Date, Time or DateTime field ${row.field}`);
        if (row.operator === "in" || row.operator === "notIn") {
          if ((row.values ?? []).length > 64) errors.push(`Restrict ${entity.name}: ${row.operator} on ${row.field} accepts at most 64 values`);
        }
        if (field.enumName) {
          const known = database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values.map((value) => value.name) ?? [];
          for (const value of row.values ?? []) {
            if (!known.includes(value)) errors.push(`Restrict ${entity.name}: unknown enum value ${field.enumName}.${value}`);
          }
        }
        if (field.type === "Integer") {
          for (const value of row.values ?? []) {
            if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) errors.push(`Restrict ${entity.name}: ${row.field} requires integer values`);
          }
        }
      }
      siblings.push(row);
    };
    for (const row of restriction.rows ?? []) normalizeRow(row, rows);
    for (const group of restriction.groups ?? []) {
      if (group.length < 2) errors.push(`Restrict ${entity.name}: a when group needs at least two conditions`);
      const normalized: QiyRowPredicate[] = [];
      for (const row of group) normalizeRow(row, normalized);
      groups.push(normalized);
    }
    /** Expression leaves go through the same checks as a standalone row predicate. */
    const normalizeExpression = (node: QiyPolicyExpression): void => {
      if (node.kind === "predicate") { normalizeRow(node.predicate, []); return; }
      if (node.kind === "cross") {
        const left = entity.fields.find((field) => field.name === node.field);
        const right = entity.fields.find((field) => field.name === node.otherField);
        if (!left) errors.push(`Restrict ${entity.name}: unknown row condition field ${node.field}`);
        if (!right) errors.push(`Restrict ${entity.name}: unknown cross-field ${node.otherField}`);
        if (left?.primaryKey || right?.primaryKey) errors.push(`Restrict ${entity.name}: cross-field comparisons cannot target a primary key`);
        return;
      }
      if (node.kind === "scope") return;
      if (node.kind === "not") { normalizeExpression(node.expression); return; }
      for (const child of node.children) normalizeExpression(child);
    };
    const expressionMentionsScope = (node: QiyPolicyExpression): boolean =>
      node.kind === "scope" ? true
        : node.kind === "not" ? expressionMentionsScope(node.expression)
          : node.kind === "and" || node.kind === "or" ? node.children.some(expressionMentionsScope)
            : false;
    if ((restriction.expressions ?? []).some(expressionMentionsScope)
      && !(options.scopes ?? []).some((scope) => scope.resource === entity.name || scope.resource === entity.tableName)) {
      errors.push(`Restrict ${entity.name}: when scope requires a matching scope declaration`);
    }
    for (const expression of restriction.expressions ?? []) normalizeExpression(expression);
    const masks: QiyFieldMask[] = [];
    for (const mask of restriction.masks ?? []) {
      const field = entity.fields.find((item) => item.name === mask.field);
      if (!field) { errors.push(`Restrict ${entity.name}: unknown mask field ${mask.field}`); continue; }
      if (field.primaryKey) errors.push(`Restrict ${entity.name}: primary key ${mask.field} cannot be masked`);
      if (field.type === "Vector") errors.push(`Restrict ${entity.name}: Vector field ${mask.field} cannot be masked`);
      if (masks.some((candidate) => candidate.field === mask.field)) errors.push(`Restrict ${entity.name}: duplicate mask for ${mask.field}`);
      if (mask.roles && (new Set(mask.roles).size !== mask.roles.length || !mask.roles.length)) errors.push(`Restrict ${entity.name}: mask roles for ${mask.field} must be unique and non-empty`);
      for (const role of mask.roles ?? []) {
        if (!roles.names.includes(role)) errors.push(`Restrict ${entity.name}: unknown mask role ${role}; declared roles are ${roles.names.join(", ")}`);
      }
      if (!["omit", "null", "redact"].includes(mask.mode)) errors.push(`Restrict ${entity.name}: unsupported mask mode ${mask.mode}`);
      if (mask.mode === "redact" && typeof mask.replacement !== "string") errors.push(`Restrict ${entity.name}: mask mode redact for ${mask.field} requires a replacement string`);
      if (mask.mode !== "redact" && mask.replacement !== undefined) errors.push(`Restrict ${entity.name}: mask replacement for ${mask.field} requires mode redact`);
      if (mask.claim && !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(mask.claim)) errors.push(`Restrict ${entity.name}: invalid mask claim ${mask.claim}`);
      if (mask.claim && mask.claimState !== "present" && mask.claimState !== "absent") errors.push(`Restrict ${entity.name}: mask claim for ${mask.field} must state present or absent`);
      if (!mask.claim && mask.claimState !== undefined) errors.push(`Restrict ${entity.name}: mask claimState for ${mask.field} requires a claim`);
      masks.push(mask);
    }
    normalizedRestrictions.push({
      resource: entity.name,
      ...(restriction.roles ? { roles: [...restriction.roles] } : {}),
      ...(rows.length ? { rows } : {}),
      ...(groups.length ? { groups } : {}),
      ...(restriction.expressions?.length ? { expressions: restriction.expressions } : {}),
      ...(masks.length ? { masks } : {}),
    });
  }
  for (const flow of options.dataflows ?? []) {
    const used = new Set(flow.context.map((binding) => binding.entity));
    for (const step of flow.steps) for (const action of step.actions) {
      if (action.kind === "create") used.add(action.entity);
    }
    for (const resource of used) {
      if (restrictedResources.has(resource)) errors.push(`Restrict ${resource}: dataflow ${flow.name} cannot use a restricted resource until command authorization applies the same row policy`);
    }
  }
  if (auth) {
    const user = database.entities.find((entity) => entity.name === auth.userEntity);
    const subject = user?.fields.find((field) => field.name === auth.subjectField);
    const role = user?.fields.find((field) => field.name === auth.roleField);
    if (!user) errors.push(`Auth: unknown user entity ${auth.userEntity}`);
    if (hasLocalAuth) {
      const username = user?.fields.find((field) => field.name === auth.usernameField);
      if (!username || (username.type !== "Text" && username.type !== "Email") || username.nullable || !username.unique) errors.push("Auth: usernameField must be a required unique Text or Email field");
      const password = user?.fields.find((field) => field.name === auth.passwordField);
      if (!password || !["Text"].includes(password.type) || !password.nullable) errors.push("Auth: passwordField must be a nullable Text field storing the password hash");
      if (username && password && username.name === password.name) errors.push("Auth: usernameField and passwordField must be different fields");
    }
    if (hasOidcAuth && (!subject || subject.type !== "Text" || subject.nullable || !subject.unique)) {
      errors.push("Auth: subjectField must be a required unique Text field");
    }
    // Hybrid projects store one identifier per OAuth provider in its own users
    // column. Binding needs a per-provider identity that can be null, so the
    // mapped columns must be nullable and unique.
    if (hybridAuth) {
      for (const provider of oidcProviders) {
        if (authProviderSubjectField(auth, provider) === auth.subjectField) {
          errors.push(`Auth: provider ${provider} needs its own nullable subjectField mapping when local password login is combined with OAuth`);
          continue;
        }
        const column = user?.fields.find((field) => field.name === authProviderSubjectField(auth, provider));
        if (!column) { errors.push(`Auth: provider ${provider} maps to unknown user field ${authProviderSubjectField(auth, provider)}`); continue; }
        if (column.type !== "Text") errors.push(`Auth: provider ${provider} subjectField must be a Text field`);
        if (!column.nullable) errors.push(`Auth: provider ${provider} subjectField ${column.name} must be nullable so accounts can exist without that binding`);
        if (!column.unique) errors.push(`Auth: provider ${provider} subjectField ${column.name} must be unique`);
      }
    }
    if (auth.profileField) {
      const profile = user?.fields.find((field) => field.name === auth.profileField);
      if (!profile || profile.type !== "Text" || !profile.nullable) errors.push("Auth: profileField must be a nullable Text field storing per-provider profile metadata");
    }
    if (hasLocalAuth && hasOidcAuth) {
      // First OAuth login creates a users row. Every required non-id column must
      // be populated by the generated onboarding endpoint.
      const autoFields = new Set([auth.usernameField, auth.passwordField, auth.roleField, auth.subjectField, auth.profileField, ...oidcProviders.map((provider) => authProviderSubjectField(auth, provider)), "email", "displayName", "name"].filter((value): value is string => Boolean(value)));
      const uncovered = (user?.fields ?? []).filter((field) => !field.primaryKey && !field.nullable && !autoFields.has(field.name));
      if (uncovered.length) errors.push(`Auth: OAuth onboarding cannot populate required user fields: ${uncovered.map((field) => field.name).join(", ")}; make them nullable`);
    }
    const roleValues = database.enums?.find((item) => item.name === role?.enumName)?.values.map((item) => item.name);
    if (!role || !roleValues || roleValues.length !== roles.names.length || roles.names.some((value) => !roleValues.includes(value))) errors.push(`Auth: roleField must be an enum whose values are exactly the declared roles (${roles.names.join(", ")})`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const scopedDatabase = { ...database, scopes: (options.scopes ?? []).map((scope) => ({ ...scope, resource: database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)!.name })), restrictions: normalizedRestrictions };
  const testClaims = JSON.stringify(Object.fromEntries((options.scopes ?? []).map((scope) => [scope.claim, database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example"])));

  const imports = database.entities.map((entity) => `import { ${modelName(entity)}Routes } from "./modules/${entity.name}/${entity.name}.routes";`).join("\n");
  const repositoryImports = database.entities.map((entity) => `import { ${modelName(entity)}Repository } from "./modules/${entity.name}/${entity.name}.repository";`).join("\n");
  const apps = database.entities.map((entity) => `    .use(${modelName(entity)}Routes(repositories.${entity.name}, authenticateRequest))`).join("\n");
  const interfaces = database.entities.map((entity) => `  ${entity.name}: import("./modules/${entity.name}/${entity.name}.contract").${modelName(entity)}Repository;`).join("\n");
  const deliveryTargets = deliveryTargetsByEvent(options.webhooks, options.notifications);
  const cronJobs = options.elysiaPlugins?.cron ?? [];
  const dataflowRoutes = renderDataflowRoutes(database, options.dataflows ?? [], options.scopes ?? [], options.actions ?? [], options.realtime !== undefined, permissions, deliveryTargets);
  const protectedResources = JSON.stringify([
    ...database.entities.map((entity) => ({ path: entity.tableName, query: entity.name })),
    ...(database.views ?? []).map((view) => ({ path: view.name, query: view.name })),
    { path: "files", query: "files" },
    ...(dataflowRoutes ? [{ path: "commands", query: "commands", mutations: (options.dataflows ?? []).flatMap((flow) => {
      const operation = `run${dataflowGraphqlName(flow.name)}`;
      return (options.actions ?? []).some((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name) ? [operation, `${operation}Batch`] : [operation];
    }) }] : []),
  ]);
  // Page-level rules are handed to the guard so REST and GraphQL share one decision.
  const pageRules = JSON.stringify(Object.fromEntries((options.pages ?? []).map((page) => [page.resource, Object.fromEntries(page.actions.map((entry) => [entry.action, entry.roles]))])));
  const baseSchema = database.dialect === "postgresql" ? generateDrizzlePostgres(database) : database.dialect === "sqlite" ? generateDrizzleSqlite(database) : generateDrizzleMysql(database);
  const usesDataflowIdempotency = (options.dataflows ?? []).some((flow) => flow.idempotency?.required);
  const generatedSchema = baseSchema
    + (usesDataflowIdempotency ? renderDataflowIdempotencySchema(database.dialect) : "")
    + ((options.dataflows ?? []).some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? renderDataflowOutboxSchema(database.dialect) : "")
    + (options.realtime ? renderRealtimeOutboxSchema(database.dialect) : "")
    + (apiKeysEnabled ? renderApiKeySchema(database.dialect) : "")
    + (hasLocalAuth ? renderSessionRevocationSchema(database.dialect) : "")
    + (usesDeliveries(options) ? renderDeliverySchema(database.dialect) : "")
    + (cronJobs.length ? renderJobLeaseSchema(database.dialect) : "");
  const pluginDependencies: Record<string, string> = {};
  if (options.elysiaPlugins?.bearer) pluginDependencies["@elysia/bearer"] = "1.4.4";
  if (options.elysiaPlugins?.serverTiming) pluginDependencies["@elysia/server-timing"] = "1.4.1";
  if (options.elysiaPlugins?.cron?.length) pluginDependencies["@elysia/cron"] = "1.4.2";
  if (options.notifications?.length) pluginDependencies.nodemailer = "10.3.1";
  if (options.elysiaPlugins?.jwt) pluginDependencies["@elysia/jwt"] = "1.4.2";
  if (options.elysiaPlugins?.static) pluginDependencies["@elysia/static"] = "1.4.11";
  if (options.elysiaPlugins?.html) pluginDependencies["@elysia/html"] = "1.4.1";
  if (options.elysiaPlugins?.graphqlAdapter === "yoga") {
    pluginDependencies["@elysia/graphql-yoga"] = "1.4.1";
    pluginDependencies["graphql-yoga"] = "5.16.0";
  }
  if (options.elysiaPlugins?.graphqlAdapter === "apollo") {
    pluginDependencies["@elysia/apollo"] = "1.4.1";
    pluginDependencies["@apollo/server"] = "5.0.0";
  }
  if (options.elysiaPlugins?.drizzle) pluginDependencies["drizzle-typebox"] = "0.3.3";
  const files: Record<string, string> = {
    ...renderAppTemplate("server", "api"),
    ...(normalizedRestrictions.length ? { "api/src/security/policy.ts": renderPolicyModule(normalizedRestrictions, database, options.scopes ?? []) } : {}),
    "api/src/import-jobs.ts": renderImportJobsModule(database.dialect),
    "api/src/saved-views.ts": renderSavedViewsModule(database.dialect, database.entities.map((entity) => entity.tableName)),
    "api/tests/saved-views.test.ts": renderSavedViewsTest(database.dialect, database.entities.map((entity) => entity.tableName), roles),
    "api/src/export-jobs.ts": renderExportJobsModule(database.dialect),
    "api/src/db.ts": database.dialect === "postgresql" ? `import { SQL } from "bun";\nimport { drizzle } from "drizzle-orm/bun-sql";\nimport * as schema from "./schema";\n\nconst url = Bun.env.DATABASE_URL;\nif (!url) throw new Error("DATABASE_URL is required");\nexport const client = new SQL(url);\nexport const db = drizzle({ client, schema });\n` : database.dialect === "sqlite" ? `import { Database } from "bun:sqlite";\nimport { drizzle } from "drizzle-orm/bun-sqlite";\nimport * as schema from "./schema";\n\nconst filename = Bun.env.DATABASE_URL ?? "./qiy.sqlite";\nexport const client = new Database(filename);\n// SQLite leaves foreign keys unenforced unless every connection opts in.\nclient.exec("PRAGMA foreign_keys = ON");\nexport const db = drizzle(client, { schema });\n` : `import mysql from "mysql2/promise";\nimport { drizzle } from "drizzle-orm/mysql2";\nimport * as schema from "./schema";\n\nconst url = Bun.env.DATABASE_URL;\nif (!url) throw new Error("DATABASE_URL is required");\nexport const client = mysql.createPool({ uri: url, timezone: "Z" });\nexport const db = drizzle({ client, schema, mode: "default" });\n`,
    ...(database.entities.some((entity) => temporalFieldsOf(entity).length) ? { "api/src/temporal.ts": renderTemporalModule() } : {}),
    ...(database.entities.some((entity) => Object.keys(entityFieldRules(entity.fields)).length) ? { "api/src/field-rules.ts": renderFieldRulesModule() } : {}),
    ...(database.entities.some((entity) => entity.fields.some((field) => field.version)) ? { "api/src/concurrency.ts": renderConcurrencyModule() } : {}),
    ...(manyRelations(database).length ? { "api/src/relation-links.ts": renderRelationLinksModule(database.dialect) } : {}),
    ...renderDatabaseOperationFiles(database),
    "api/src/pagination.ts": `export function withPaginationLimit<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "list" || typeof value !== "function") return value;
      return (page: number, pageSize: number, ...args: unknown[]) => {
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid pagination");
        return Reflect.apply(value, target, [page, pageSize, ...args]);
      };
    },
  });
}
`,
    "api/src/schema.ts": `${generatedDocumentation(database)}${generatedSchema}`,
    "api/drizzle.config.ts": database.dialect === "postgresql" ? `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "postgresql", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://qiy:qiy@localhost:5432/qiy" } });\n` : database.dialect === "sqlite" ? `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "sqlite", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "./qiy.sqlite" } });\n` : `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "mysql", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "mysql://qiy:qiy@localhost:3306/qiy" } });\n`,
    "api/src/app.ts": `import { Elysia } from "elysia";
 import { cors } from "@elysia/cors";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 ${apiKeysEnabled ? 'import { withApiKeyAuthentication } from "./auth/api-keys";' : ""}
 ${permissions ? 'import { loadPermissions } from "./auth/permissions";' : ""}
 ${options.realtime ? 'import { createRealtimeRoutes } from "./realtime";' : ""}
 ${imports}

export interface Repositories {
${interfaces}
}

export function normalizeCorsOrigins(origins: string[]): string[] {
  const unique = new Set<string>();
  for (const origin of origins) {
    if (origin.includes("*")) throw new Error("CORS origin must be an exact http(s) origin without a path or wildcard: " + origin);
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error("Invalid CORS origin: " + origin); }
    if (origin.includes("*") || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error("CORS origin must be an exact http(s) origin without a path or wildcard: " + origin);
    }
    unique.add(origin);
  }
  return [...unique];
}

export async function createApp(repositories: Repositories, authenticate: Authenticator = async () => null, includeStorage = true, corsOrigins?: string[], includeDataflows = true) {
   // API-key requests are resolved after the configured session authenticator has
   // had a chance to accept the request, so key auth is additive and never weakens
   // the project's existing authentication.
   const authenticateRequest = ${apiKeysEnabled ? "withApiKeyAuthentication(authenticate)" : "authenticate"};
   const configuredOrigins = ${JSON.stringify(options.corsOrigins ?? [])} as string[];
   const environmentOrigins = Bun.env.QIY_CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
   const allowedOrigins = normalizeCorsOrigins(corsOrigins ?? (environmentOrigins.length > 0 ? environmentOrigins : configuredOrigins));
   const guard = createAuthorizationGuard(authenticateRequest, ${protectedResources}, ${pageRules}, ${JSON.stringify(hybridAuth ? ["/api/v1/auth/providers", "/api/v1/auth/exchange", "/api/v1/auth/oauth/register"] : multiProviderAuth ? ["/api/v1/auth/providers", "/api/v1/auth/exchange"] : [])}, ${JSON.stringify(dataflowRoutes ? ["commands"] : [])});
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => {
      const principal = await authenticateRequest(request);
      if (!principal) return null;${permissions ? `
      // Effective permissions are always additive: role group, database column and verified claims.
      const permissionSnapshot = await loadPermissions(principal);
      return { ...principal, permissions: permissionSnapshot.permissions, groups: permissionSnapshot.groups };` : ""}
    })
 ${apps};
 ${dataflowRoutes ? '   const dataflows = includeDataflows ? (await import("./dataflows")).createDataflowRoutes(authenticateRequest) : undefined;' : ''}
    ${options.realtime ? "const realtime = createRealtimeRoutes(authenticateRequest);" : ""}
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticateRequest) : undefined;
    ${(database.views ?? []).length ? 'const viewRoutes = (await import("./views-routes")).createViewRoutes(authenticateRequest);' : ""}
    ${hasLocalAuth ? 'const authRoutes = (await import("./auth/local")).createLocalAuthRoutes();' : auth?.provider === "otp" ? 'const authRoutes = (await import("./auth/otp")).createOtpAuthRoutes();' : ''}
    ${hasLocalAuth ? 'const accountRoutes = (await import("./auth/account")).createAccountRoutes(authenticateRequest);' : ''}
    ${apiKeysEnabled ? 'const apiKeyRoutes = (await import("./auth/api-keys")).createApiKeyRoutes(authenticateRequest);' : ''}
    ${hybridAuth ? 'const authProviderRoutes = (await import("./auth/oidc")).createHybridAuthRoutes(authenticateRequest);' : multiProviderAuth ? 'const authProviderRoutes = (await import("./auth/oidc")).createAuthProviderRoutes();' : ''}
    ${permissions ? 'const permissionRoutes = (await import("./auth/permission-routes")).createPermissionRoutes(authenticateRequest);' : ''}
    ${docsModelEnabled ? 'const docsRoutes = (await import("./docs-routes")).createDocsRoutes(authenticateRequest);' : ''}
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-API-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes)${(database.views ?? []).length ? ".use(viewRoutes)" : ""}${options.elysiaPlugins?.graphqlAdapter && options.elysiaPlugins.graphqlAdapter !== "native" ? '' : '.use(createGraphQLRoutes(repositories, authenticateRequest))'};
    let composed = application;
    ${hasLocalAuth || auth?.provider === "otp" ? "composed = composed.use(authRoutes);" : ""}
    ${hasLocalAuth ? "composed = composed.use(accountRoutes);" : ""}
    ${apiKeysEnabled ? "composed = composed.use(apiKeyRoutes);" : ""}
    ${hybridAuth || multiProviderAuth ? "composed = composed.use(authProviderRoutes);" : ""}
    ${permissions ? "composed = composed.use(permissionRoutes);" : ""}
    ${docsModelEnabled ? "composed = composed.use(docsRoutes);" : ""}
    ${dataflowRoutes ? "composed = dataflows ? composed.use(dataflows) : composed;" : ""}
    ${options.realtime ? "composed = composed.use(realtime);" : ""}
    composed = storage ? composed.use(storage) : composed;
    composed = composed.use((await import("./saved-views")).createSavedViewsRoutes(authenticateRequest));
    ${auth ? 'composed = composed.use((await import("./audit/routes")).createAuditRoutes(authenticateRequest));' : ""}
    return registerPlugins(composed, { repositories, authenticate: authenticateRequest });
}
`,
    "api/src/modules/index.ts": database.entities.map((entity) => `export { ${modelName(entity)}Routes } from "./${entity.name}/${entity.name}.routes";`).join("\n") + "\n",
    ...((database.views ?? []).length ? { "api/src/views-routes.ts": renderViewRoutes(scopedDatabase, auth !== undefined)! } : {}),
    "api/src/graphql.ts": renderGraphQL(scopedDatabase, hasLocalAuth ? { [options.auth!.userEntity]: [options.auth!.passwordField!] } : {}, options.dataflows ?? [], options.actions ?? [], (options.realtime?.resources ?? []).flatMap((resource) => {
      const entity = scopedDatabase.entities.find((candidate) => candidate.name === resource.resource || candidate.tableName === resource.resource);
      return entity ? [entity] : [];
    })),
    "api/src/graphql-adapter.ts": renderGraphQLAdapter(scopedDatabase, options.dataflows ?? [], options.actions ?? []),
    ...(options.realtime ? {
      "api/src/realtime-bus.ts": `export interface QiyRealtimeBusEvent { id: string; channel: string; event: string; record: Record<string, unknown> }

type Listener = (event: QiyRealtimeBusEvent) => void;
const listeners = new Set<Listener>();

/** In-process fan-out of outbox events to this instance's SSE and GraphQL subscribers. */
export function publishRealtimeEvent(event: QiyRealtimeBusEvent): void {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* one failing subscriber must not break delivery */ }
  }
}

export function subscribeRealtimeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
`,
      "api/src/realtime.ts": renderRealtime(options.realtime, options.dataflows ?? [], roles),
      "api/tests/realtime.test.ts": `import { afterEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { Principal } from "../src/auth/guard";
import { publishRealtimeEvent } from "../src/realtime-bus";
import { createRealtimeRoutes, realtimeCapabilities, realtimeChannelIterator, realtimeCleanupCutoff } from "../src/realtime";

afterEach(() => { Bun.env.QIY_REALTIME_DISABLED = "1"; });

const subscription = ${JSON.stringify(options.realtime.resources[0])} as { resource: string; roles: string[]; claim?: { field: string; claim: string } };
const principal = { id: "user-1", name: "User", role: subscription.roles[0], claims: subscription.claim ? { [subscription.claim.claim]: "eu" } : {} } as unknown as Principal;
const stream = (app: { handle: (request: Request) => Promise<Response> }) => app.handle(new Request("http://localhost/api/v1/realtime/stream"));

test("rejects anonymous callers, roles without channels and a disabled transport", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  expect((await stream(new Elysia().use(createRealtimeRoutes(async () => null)))).status).toBe(401);
  const denied = (${JSON.stringify(roles.names)} as const).find((role) => Object.keys(realtimeCapabilities({ id: "u", name: "U", role } as Principal)).length === 0);
  if (denied) {
    const response = await stream(new Elysia().use(createRealtimeRoutes(async () => ({ id: "u", name: "U", role: denied } as Principal))));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Realtime subscription is not permitted" });
  }
  Bun.env.QIY_REALTIME_DISABLED = "1";
  expect((await stream(new Elysia().use(createRealtimeRoutes(async () => principal)))).status).toBe(503);
});

test("streams only the channels granted to the caller", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const channel = Object.keys(realtimeCapabilities(principal))[0]!;
  const response = await stream(new Elysia().use(createRealtimeRoutes(async () => principal)));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const read = async () => decoder.decode((await reader.read()).value);
  expect(await read()).toContain("event: ready");
  publishRealtimeEvent({ id: "event-1", channel: "qiy:not-granted", event: "created", record: { id: "x" } });
  publishRealtimeEvent({ id: "event-2", channel, event: "updated", record: { id: "record-1" } });
  const frame = await read();
  expect(frame).toContain('"id":"event-2"');
  expect(frame).not.toContain("qiy:not-granted");
  await reader.cancel();
});

test("iterates events per channel and stops after close", async () => {
  const iterator = realtimeChannelIterator("qiy:" + subscription.resource);
  publishRealtimeEvent({ id: "event-3", channel: "qiy:other", event: "created", record: {} });
  publishRealtimeEvent({ id: "event-4", channel: "qiy:" + subscription.resource, event: "created", record: { id: "record-4" } });
  expect((await iterator.next()).value?.id).toBe("event-4");
  iterator.close();
  expect((await iterator.next()).done).toBe(true);
});

test("computes the outbox cleanup cutoff from the retention window", () => {
  expect(realtimeCleanupCutoff(7, new Date("2026-10-12T12:00:00.000Z"))).toEqual(new Date("2026-10-05T12:00:00.000Z"));
  expect(() => realtimeCleanupCutoff(0)).toThrow("retention days");
});
`,
    } : {}),
    "api/tests/pagination.test.ts": `import { expect, test } from "bun:test";
import { withPaginationLimit } from "../src/pagination";

test("rejects page sizes above the API limit", async () => {
  const service = withPaginationLimit({ list: async (page: number, pageSize: number) => ({ page, pageSize }) });
  expect(() => service.list(1, 101)).toThrow("Invalid pagination");
  expect(() => service.list(0, 10)).toThrow("Invalid pagination");
  expect(await service.list(2, 50)).toEqual({ page: 2, pageSize: 50 });
});
`,
    "api/tests/app.test.ts": `import { expect, test } from "bun:test";
import { createApp, normalizeCorsOrigins, type Repositories } from "../src/app";
import { createHandler } from "../src/http";

const repository = {
  distribution: async () => [],
  list: async () => ({ data: [], total: 0 }),
  one: async () => undefined,
  create: async () => ({}),
  update: async () => undefined,
  delete: async () => undefined,
  deleteMany: async () => [],
};

test("mounts REST and GraphQL at their public paths", async () => {
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: crypto.randomUUID(), name: "Test Admin", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }));
  const handle = createHandler((request) => app.handle(request), "./build/client");
  expect((await handle(new Request("http://localhost/api/v1/health"))).status).toBe(200);
  const specification = await handle(new Request("http://localhost/api/v1/openapi/json"));
  expect(specification.status).toBe(200);
  expect((await specification.json() as { paths: Record<string, unknown> }).paths["/api/v1/${database.entities[0]!.tableName}/"]).toBeDefined();
  const graphql = await handle(new Request("http://localhost/graphql", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { ${database.entities[0]!.name} { total } }" }),
  }));
  expect(graphql.status).toBe(200);
  expect((await graphql.json() as { data: { ${database.entities[0]!.name}: { total: number } } }).data.${database.entities[0]!.name}.total).toBe(0);
  expect((await handle(new Request("http://localhost/api/v1/graphql", { method: "POST" }))).status).toBe(404);
});

test("enables CORS only for explicitly configured origins", async () => {
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "cors-test", name: "Admin", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }), false, ["https://admin.example"]);
  const allowed = await app.handle(new Request("http://localhost/api/v1/health", { headers: { Origin: "https://admin.example" } }));
  expect(allowed.headers.get("access-control-allow-origin")).toBe("https://admin.example");
  const preflight = await app.handle(new Request("http://localhost/api/v1/health", { method: "OPTIONS", headers: { Origin: "https://admin.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("https://admin.example");
  expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  const denied = await app.handle(new Request("http://localhost/api/v1/health", { headers: { Origin: "https://untrusted.example" } }));
  expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  expect(normalizeCorsOrigins(["https://admin.example", "https://admin.example"])).toEqual(["https://admin.example"]);
  expect(() => normalizeCorsOrigins(["*"])).toThrow("exact http(s) origin");
  expect(() => normalizeCorsOrigins(["https://admin.example/path"])).toThrow("exact http(s) origin");
});

test("denies anonymous REST and GraphQL and enforces role permissions", async () => {
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const target = "http://localhost/api/v1/${database.entities.find((entity) => entity.tableName !== "users")?.tableName ?? database.entities[0]!.tableName}/";
  const graph = "http://localhost/graphql";
  const anonymous = await createApp(repositories);
  expect((await anonymous.handle(new Request(target))).status).toBe(401);
  expect((await anonymous.handle(new Request(graph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${database.entities[0]!.name} { total } }" }) }))).status).toBe(401);
  ${roles.reader ? `const viewer = await createApp(repositories, async () => ({ id: "viewer", name: "Viewer", role: ${JSON.stringify(roles.reader)}, claims: ${testClaims} }));
  expect((await viewer.handle(new Request(target))).status).toBe(200);
  expect((await viewer.handle(new Request(target, { method: "DELETE" }))).status).toBe(403);
  expect((await viewer.handle(new Request(graph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { delete${modelName(database.entities[0]!)}(id: \\"00000000-0000-4000-8000-000000000002\\") { id } }" }) }))).status).toBe(403);` : ""}
});

test("passes the authenticated actor through REST and GraphQL mutations", async () => {
  const actors: Array<string | undefined> = [];
  const id = "00000000-0000-4000-8000-000000000002";
  const tracked = { ...repository, async delete(_id: string, actorId?: string) { actors.push(actorId); return { id }; } };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, tracked])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id, name: "Admin", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }));
  expect((await app.handle(new Request("http://localhost/api/v1/${database.entities[0]!.tableName}/" + id, { method: "DELETE" }))).status).toBe(200);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { delete${modelName(database.entities[0]!)}(id: \\"" + id + "\\") { id } }" }) }));
  expect(graph.status).toBe(200);
  expect(actors).toEqual([id, id]);
});

${uploadField ? "test" : "test.skip"}("protects file storage endpoints and rejects traversal", async () => {
  Bun.env.QIY_STORAGE_METADATA = "memory";
  Bun.env.QIY_STORAGE_PROVIDER = "local";
  Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }));
  const resource = ${JSON.stringify(uploadField?.entity.tableName ?? "missing")};
  const field = ${JSON.stringify(uploadField?.field.name ?? "missing")};
  const uploadMode = String(${JSON.stringify(uploadField?.field.uploadMode ?? "binary")}) as "binary" | "base64" | "both";
  const maxBytes = ${uploadField?.field.maxBytes ?? 25 * 1024 * 1024};
  const contentType = ${JSON.stringify(uploadField?.field.mimeTypes?.find((mime) => !mime.endsWith("/*") && mime !== "*/*") ?? (uploadField?.field.mimeTypes?.find((mime) => mime.endsWith("/*"))?.replace("*", "qiy-test") ?? "application/octet-stream"))};
  const restrictsMime = ${JSON.stringify(Boolean(uploadField?.field.mimeTypes?.length && !uploadField.field.mimeTypes.includes("*/*")))};
  const key = resource + "/" + crypto.randomUUID() + ".bin";
  const fileUrlFor = (targetKey: string, targetField = field) => "http://localhost/api/v1/files?key=" + encodeURIComponent(targetKey) + "&fileName=fixture.bin&resource=" + resource + "&field=" + targetField + "&resourceId=00000000-0000-4000-8000-000000000001";
  const base64Url = "http://localhost/api/v1/files/base64";
  const upload = (targetKey: string, bytes = "invoice", mime = contentType) => uploadMode === "base64"
    ? app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: targetKey, fileName: "fixture.bin", resource, field, resourceId: "00000000-0000-4000-8000-000000000001", contentType: mime, data: Buffer.from(bytes).toString("base64") }) }))
    : app.handle(new Request(fileUrlFor(targetKey), { method: "POST", body: new Blob([bytes], { type: mime }) }));
  const fileUrl = fileUrlFor(key);
  const metadataUrl = "http://localhost/api/v1/files/metadata?key=" + encodeURIComponent(key);
  expect((await upload(key)).status).toBe(200);
  const metadata = await app.handle(new Request(metadataUrl));
  expect(metadata.status).toBe(200);
  expect(await metadata.json() as { ownerId: string; size: number; storageKey: string; fileName: string; resource: string; resourceId: string }).toMatchObject({ ownerId: "admin", size: 7, storageKey: key, fileName: "fixture.bin", resource: ${JSON.stringify(uploadField?.entity.tableName ?? "missing")}, resourceId: "00000000-0000-4000-8000-000000000001" });
  expect((await upload(key)).status).toBe(409);
  expect((await app.handle(new Request(fileUrlFor(resource + "/unknown.bin", "missing"), { method: "POST", body: new Blob(["ok"], { type: contentType }) }))).status).toBe(400);
  if (restrictsMime) expect((await upload(resource + "/wrong-mime.bin", "ok", "application/x-qiy-disallowed")).status).toBe(415);
  expect((await upload(resource + "/too-large.bin", "x".repeat(maxBytes + 1))).status).toBe(413);
  expect((await app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: resource + "/malformed.bin", resource, field, contentType, data: "not base64" }) }))).status).toBe(400);
  if (uploadMode === "binary") {
    expect((await app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: resource + "/base64-rejected.bin", resource, field, contentType, data: Buffer.from("ok").toString("base64") }) }))).status).toBe(415);
  } else {
    const base64Key = resource + "/" + crypto.randomUUID() + "-base64.bin";
    expect((await app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: base64Key, resource, field, contentType, data: Buffer.from("base64").toString("base64") }) }))).status).toBe(200);
    expect((await app.handle(new Request(fileUrlFor(base64Key)))).status).toBe(200);
    expect((await app.handle(new Request(fileUrlFor(base64Key), { method: "DELETE" }))).status).toBe(200);
  }
  if (uploadMode === "base64") expect((await app.handle(new Request(fileUrlFor(resource + "/binary-rejected.bin"), { method: "POST", body: new Blob(["ok"], { type: contentType }) }))).status).toBe(415);
  const download = await app.handle(new Request(fileUrl));
  expect(download.status).toBe(200);
  expect(await download.text()).toBe("invoice");
  ${roles.member ? `const viewer = await createApp(repositories, async () => ({ id: "another-user", name: "Viewer", role: ${JSON.stringify(roles.member)}, claims: ${testClaims} }));
  expect((await viewer.handle(new Request(fileUrl))).status).toBe(404);
  expect((await viewer.handle(new Request(metadataUrl))).status).toBe(404);` : ""}
  expect((await app.handle(new Request("http://localhost/api/v1/files?key=../secret"))).status).toBe(400);
  expect((await app.handle(new Request(fileUrl, { method: "DELETE" }))).status).toBe(200);
  expect((await app.handle(new Request(metadataUrl))).status).toBe(404);
});
`,
    "api/package.json": (() => {
      const base = JSON.parse(renderAppTemplate("server", "api")["api/package.json"] ?? "{}") as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      base.dependencies = { ...(base.dependencies ?? {}), ...pluginDependencies };
      // drizzle-kit loads migrations through a dialect driver that is separate from
      // the runtime driver used by src/db.ts, so PostgreSQL projects need `postgres`
      // installed before `bun run db:migrate` can connect.
      if (database.dialect === "postgresql") base.devDependencies = { ...(base.devDependencies ?? {}), postgres: "3.4.7" };
      return JSON.stringify(base, null, 2) + "\n";
    })(),

    "api/src/plugins/index.ts": `import type { Elysia } from "elysia";
${options.elysiaPlugins?.bearer ? 'import { bearer } from "@elysia/bearer";' : ""}
${options.elysiaPlugins?.serverTiming ? 'import { serverTiming } from "@elysia/server-timing";' : ""}
${cronJobs.length ? 'import { cron } from "@elysia/cron";\nimport { claimJobTick, scheduledTick } from "../jobs/lease";' : ""}${cronJobs.some(isDataflowCronJob) ? '\nimport { runScheduledDataflow } from "../jobs/scheduled";' : ""}
${options.elysiaPlugins?.jwt ? 'import { jwt } from "@elysia/jwt";' : ""}
${options.elysiaPlugins?.static ? 'import { staticPlugin } from "@elysia/static";' : ""}
${options.elysiaPlugins?.html ? 'import { html } from "@elysia/html";' : ""}
${options.elysiaPlugins?.graphqlAdapter === "yoga" ? 'import { yoga } from "@elysia/graphql-yoga";' : ""}
${options.elysiaPlugins?.graphqlAdapter === "apollo" ? 'import { apollo } from "@elysia/apollo";' : ""}
${options.elysiaPlugins?.graphqlAdapter && options.elysiaPlugins.graphqlAdapter !== "native" ? 'import { createGraphQLContext, graphqlTypeDefs } from "../graphql";\nimport { createGraphQLAdapterResolvers } from "../graphql-adapter";' : ""}
${options.elysiaPlugins?.drizzle ? 'import { db } from "../db";' : ""}
${cronJobs.some((job) => !isDataflowCronJob(job)) ? 'import { cleanupMissingAttachmentObjects } from "../storage/routes";' : ""}

export interface PluginContext {
  repositories: import("../app").Repositories;
  authenticate: import("../auth/guard").Authenticator;
}
export interface QiyPlugin {
  name: string;
  setup(app: any, context?: PluginContext): any;
}
${cronJobs.some((job) => !isDataflowCronJob(job)) ? `export function createCleanupCronJob(name: string, pattern: string, cleanup = cleanupMissingAttachmentObjects, claim = claimJobTick) {
  return cron({ name, pattern, unref: true, protect: true,
    catch: (error) => console.error(\`[qiy:cron:\${name}] failed\`, error),
    async run() {
    if (!(await claim(name, scheduledTick(pattern)))) return;
    const limit = Number(Bun.env.QIY_ATTACHMENT_CLEANUP_LIMIT ?? 1000);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("QIY_ATTACHMENT_CLEANUP_LIMIT must be an integer from 1 to 10000");
    const result = await cleanup({ dryRun: false, limit });
    console.info(\`[qiy:cron:\${name}]\`, result);
  } });
}` : ""}${cronJobs.some(isDataflowCronJob) ? `
/** Every instance schedules the job; the tick lease lets exactly one of them run the dataflow. */
export function createDataflowCronJob(name: string, pattern: string, flow: string, run = runScheduledDataflow) {
  return cron({ name, pattern, unref: true, protect: true,
    catch: (error) => console.error(\`[qiy:cron:\${name}] failed\`, error),
    async run() {
    const outcome = await run(name, flow, scheduledTick(pattern));
    if (!outcome.skipped) console.info(\`[qiy:cron:\${name}] \${flow} completed\`);
  } });
}` : ""}
export const plugins: QiyPlugin[] = [
${options.elysiaPlugins?.bearer ? '  { name: "bearer", setup: (app) => app.use(bearer()) },' : ""}
${options.elysiaPlugins?.serverTiming ? '  { name: "server-timing", setup: (app) => app.use(serverTiming()) },' : ""}
${options.elysiaPlugins?.html ? '  { name: "html", setup: (app) => app.use(html()) },' : ""}
${options.elysiaPlugins?.drizzle ? '  { name: "drizzle", setup: (app) => app.decorate("db", db) },' : ""}
${options.elysiaPlugins?.jwt ? `  { name: "jwt", setup: (app) => {
    const secret = Bun.env[${JSON.stringify(options.elysiaPlugins.jwt.secretEnv)}];
    if (!secret) throw new Error(${JSON.stringify(`${options.elysiaPlugins.jwt.secretEnv} is required when the Elysia JWT plugin is enabled`)});
    return app.use(jwt({ name: ${JSON.stringify(options.elysiaPlugins.jwt.name)}, secret }));
  } },` : ""}
${options.elysiaPlugins?.static ? `  { name: "static", setup: async (app) => app.use(await staticPlugin({ assets: ${JSON.stringify(options.elysiaPlugins.static.assets)}, prefix: ${JSON.stringify(options.elysiaPlugins.static.prefix)} })) },` : ""}
${options.elysiaPlugins?.graphqlAdapter === "yoga" ? `  { name: "graphql-yoga", setup: (app, context) => context ? app.use(yoga({ path: "/graphql", graphiql: false, landingPage: false, typeDefs: graphqlTypeDefs as string, resolvers: createGraphQLAdapterResolvers(context.repositories, context.authenticate) as any, context: ({ request }) => ({ request }) })) : app },` : ""}
${options.elysiaPlugins?.graphqlAdapter === "apollo" ? `  { name: "graphql-apollo", setup: async (app, context) => context ? app.use(await apollo({ path: "/graphql", enablePlayground: false, typeDefs: graphqlTypeDefs, resolvers: createGraphQLAdapterResolvers(context.repositories, context.authenticate) as any, context: async ({ request }: any) => ({ request }) })) : app },` : ""}
${cronJobs.map((job) => `  { name: ${JSON.stringify(job.name)}, setup: (app) => Bun.env.QIY_CRON_ENABLED === "1" ? app.use(${isDataflowCronJob(job) ? `createDataflowCronJob(${JSON.stringify(job.name)}, ${JSON.stringify(job.pattern)}, ${JSON.stringify(job.dataflow)})` : `createCleanupCronJob(${JSON.stringify(job.name)}, ${JSON.stringify(job.pattern)})`}) : app },`).join("\n")}
];
export async function registerPlugins(app: Elysia, context?: PluginContext): Promise<Elysia> {
  let configured: any = app;
  for (const plugin of plugins) configured = await plugin.setup(configured, context);
  return configured as Elysia;
}
`,
    ...(options.elysiaPlugins?.jwt ? { "api/tests/jwt-plugin.test.ts": `import { Elysia } from "elysia";
import { expect, test } from "bun:test";
import { registerPlugins } from "../src/plugins";

const secretName = ${JSON.stringify(options.elysiaPlugins.jwt.secretEnv)};

test("JWT plugin refuses to start without its configured secret", async () => {
  const secret = Bun.env[secretName];
  delete Bun.env[secretName];
  try {
    await expect(registerPlugins(new Elysia())).rejects.toThrow(secretName + " is required");
  } finally {
    if (secret === undefined) delete Bun.env[secretName];
    else Bun.env[secretName] = secret;
  }
});

test("JWT plugin signs and verifies tokens through the generated registration", async () => {
  const app = (await registerPlugins(new Elysia())).get("/plugin-token", async (context) => {
    const tokenService = (context as unknown as Record<string, {
      sign(value: { sub: string }): Promise<string>;
      verify(value: string): Promise<{ sub: string } | false>;
    }>)[${JSON.stringify(options.elysiaPlugins.jwt.name)}];
    const token = await tokenService.sign({ sub: "test-user" });
    const verified = await tokenService.verify(token);
    return { subject: verified ? verified.sub : null${options.elysiaPlugins?.bearer ? ', bearer: (context as unknown as { bearer?: string }).bearer' : ''} };
  });
  const response = await app.handle(new Request("http://localhost/plugin-token"${options.elysiaPlugins?.bearer ? ', { headers: { authorization: "Bearer test-access" } }' : ''}));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ subject: "test-user"${options.elysiaPlugins?.bearer ? ', bearer: "test-access"' : ''} });
});
` } : {}),
    ...(options.elysiaPlugins?.static ? { "api/tests/static-plugin.test.ts": `import { Elysia } from "elysia";
import { expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { registerPlugins } from "../src/plugins";

test("serves the configured public directory but does not expose server source", async () => {
  const fixture = ${JSON.stringify(`${options.elysiaPlugins.static.assets}/qiy-plugin-probe.txt`)};
  await Bun.write(fixture, "qiy-public-fixture");
  try {
    const app = await registerPlugins(new Elysia());
    const publicFile = await app.handle(new Request(${JSON.stringify(`http://localhost${options.elysiaPlugins.static.prefix}/qiy-plugin-probe.txt`)}));
    expect(publicFile.status).toBe(200);
    expect(await publicFile.text()).toBe("qiy-public-fixture");
    const source = await app.handle(new Request(${JSON.stringify(`http://localhost${options.elysiaPlugins.static.prefix}/src/db.ts`)}));
    expect(source.status).toBe(404);
  } finally {
    await unlink(fixture);
  }
});
` } : {}),
    ...(options.elysiaPlugins?.serverTiming || options.elysiaPlugins?.drizzle ? { "api/tests/plugin-context.test.ts": `import { Elysia } from "elysia";
import { expect, test } from "bun:test";
import { registerPlugins } from "../src/plugins";
${options.elysiaPlugins?.drizzle ? 'import { db } from "../src/db";' : ""}

test("configured Elysia plugins expose their runtime capabilities", async () => {
  const app = (await registerPlugins(new Elysia())).get("/plugin-context", (context) => ({
${options.elysiaPlugins?.drizzle ? '    hasDb: (context as unknown as { db: unknown }).db === db,' : ""}
    ok: true,
  }));
  const response = await app.handle(new Request("http://localhost/plugin-context"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ${options.elysiaPlugins?.drizzle ? "hasDb: true, " : ""}ok: true });
${options.elysiaPlugins?.serverTiming ? '  expect(response.headers.get("server-timing")).toMatch(/total;dur=/);' : ""}
});
` } : {}),
    ...(cronJobs.length ? { "api/tests/cron.test.ts": `import { Elysia } from "elysia";
import { expect, mock, test } from "bun:test";
import { ${[cronJobs.some((job) => !isDataflowCronJob(job)) ? "createCleanupCronJob" : "", cronJobs.some(isDataflowCronJob) ? "createDataflowCronJob" : "", "registerPlugins"].filter(Boolean).join(", ")} } from "../src/plugins";

type CapturedJob = { stop(): void; trigger(): Promise<void> };

async function capture(plugin: Parameters<Elysia["use"]>[0], name: string): Promise<CapturedJob> {
  const captured: { job?: CapturedJob } = {};
  const app = new Elysia().use(plugin).get("/capture", ({ store }) => {
    captured.job = (store as { cron: Record<string, CapturedJob> }).cron[name];
    return "ok";
  });
  await app.handle(new Request("http://localhost/capture"));
  if (!captured.job) throw new Error("Cron plugin did not register " + name);
  captured.job.stop();
  return captured.job;
}

test("does not start Cron unless explicitly enabled", async () => {
  const previous = Bun.env.QIY_CRON_ENABLED;
  delete Bun.env.QIY_CRON_ENABLED;
  try {
    const app = (await registerPlugins(new Elysia())).get("/has-cron", ({ store }) => "cron" in store);
    const response = await app.handle(new Request("http://localhost/has-cron"));
    expect(await response.text()).toBe("false");
  } finally {
    if (previous === undefined) delete Bun.env.QIY_CRON_ENABLED;
    else Bun.env.QIY_CRON_ENABLED = previous;
  }
});

${cronJobs.some((job) => !isDataflowCronJob(job)) ? `test("triggers the configured attachment cleanup task", async () => {
  const cleanup = mock(async () => ({ checked: 1, removed: 1, dryRun: false }));
  const job = await capture(createCleanupCronJob("testCleanup", "0 0 * * *", cleanup, async () => true), "testCleanup");
  const previous = console.info;
  console.info = () => {};
  try {
    await job.trigger();
    expect(cleanup).toHaveBeenCalledWith({ dryRun: false, limit: 1000 });
  } finally {
    console.info = previous;
  }
});

test("skips cleanup when another instance claimed the tick", async () => {
  const cleanup = mock(async () => ({ checked: 0, removed: 0, dryRun: false }));
  const job = await capture(createCleanupCronJob("claimedCleanup", "0 0 * * *", cleanup, async () => false), "claimedCleanup");
  await job.trigger();
  expect(cleanup).not.toHaveBeenCalled();
});

test("reports cleanup failures without a silent cron callback", async () => {
  const cleanup = mock(async () => { throw new Error("storage unavailable"); });
  const job = await capture(createCleanupCronJob("failedCleanup", "0 0 * * *", cleanup, async () => true), "failedCleanup");
  const previous = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await job.trigger();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(errors[0]?.[0]).toBe("[qiy:cron:failedCleanup] failed");
  } finally {
    console.error = previous;
  }
});
` : ""}${cronJobs.some(isDataflowCronJob) ? `
test("dataflow jobs run their command for the current tick", async () => {
  const run = mock(async (_job: string, _flow: string, _tick: Date) => ({ skipped: false as const, result: null }));
  const job = await capture(createDataflowCronJob("testFlow", "*/5 * * * *", "someFlow", run), "testFlow");
  const previous = console.info;
  console.info = () => {};
  try {
    await job.trigger();
  } finally {
    console.info = previous;
  }
  expect(run).toHaveBeenCalledTimes(1);
  const [name, flow, tick] = run.mock.calls[0]!;
  expect([name, flow]).toEqual(["testFlow", "someFlow"]);
  expect(tick.getUTCSeconds()).toBe(0);
});
` : ""}` } : {}),
    ...(usesDeliveries(options) ? { "api/src/delivery/index.ts": renderDeliveryModule(database.dialect, options), "api/tests/delivery.test.ts": renderDeliveryTest(database.dialect, options) } : {}),
    ...(cronJobs.length ? { "api/src/jobs/lease.ts": renderJobLeaseModule(database.dialect) } : {}),
    ...(cronJobs.some(isDataflowCronJob) ? { "api/src/jobs/scheduled.ts": renderScheduledDataflowModule(cronJobs, options.auth), "api/tests/scheduled.test.ts": renderScheduledDataflowTest(cronJobs, database.dialect) } : {}),
    "api/src/hooks/index.ts": `export interface ServerHooks {
  beforeRequest?(request: Request): void | Promise<void>;
  afterResponse?(request: Request, response: Response): void | Promise<void>;
}
`,
    "api/src/shared/errors.ts": `export class AppError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
`,
    "api/src/server.ts": `import { resolve } from "node:path";
import { createApp } from "./app";
import { createHandler } from "./http";
${auth ? `import { createProductionAuthenticator } from ${hybridAuth ? '"./auth/hybrid"' : hasLocalAuth ? '"./auth/local"' : auth.provider === "otp" ? '"./auth/otp"' : '"./auth/oidc"'};` : ''}
${options.realtime ? 'import { startRealtimeOutboxCleanup } from "./realtime";' : ''}${usesDeliveries(options) ? '\nimport { startDeliveryWorker } from "./delivery";' : ''}
${repositoryImports}

${auth ? '' : 'if (Bun.env.QIY_DEV_MODE !== "1") {'}
${auth ? '' : '  throw new Error("Unauthenticated V0 admin API is disabled: set QIY_DEV_MODE=1 for local development only");'}
${auth ? '' : '}'}

if (Bun.env.QIY_STORAGE_METADATA !== "database") throw new Error("QIY_STORAGE_METADATA=database is required for production file metadata");
const app = await createApp({ ${database.entities.map((entity) => `${entity.name}: ${modelName(entity)}Repository`).join(", ")} }, ${auth ? 'createProductionAuthenticator()' : 'async () => ({ id: "dev", name: "Local Admin", role: "admin" })'});
${options.realtime ? 'startRealtimeOutboxCleanup();' : ''}${usesDeliveries(options) ? '\nstartDeliveryWorker();' : ''}
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: Bun.env.HOST ?? "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(\`Qiy app listening on http://localhost:\${server.port}\`);
`,
    "api/src/preview.ts": `import { resolve } from "node:path";
import { createApp, type Repositories } from "./app";
import { createHandler } from "./http";

const repositories: Repositories = {
${database.entities.map((entity) => previewRepository(entity, database, options.scopes ?? [])).join("\n")}
};
const app = await createApp(repositories, async () => ({ id: "preview", name: "Preview Admin", role: ${JSON.stringify(roles.admin)}, claims: ${JSON.stringify(Object.fromEntries((options.scopes ?? []).map((scope) => [scope.claim, database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : `Demo ${database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)?.name}`])))} }), ${options.storageProvider !== "s3"});
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(\`Local-only Qiy preview: http://127.0.0.1:\${server.port}\`);
`,
  };
  if (dataflowRoutes) files["api/src/dataflows/index.ts"] = dataflowRoutes;
  const dataflowCallContracts = renderDataflowCallContracts(options.dataflows ?? []);
  const dataflowCallExtensions = renderDataflowCallExtensions(options.dataflows ?? []);
  if (dataflowCallContracts) files["api/src/dataflows/calls.ts"] = dataflowCallContracts;
  if (dataflowCallExtensions) files["api/src/extensions/dataflow-calls.ts"] = dataflowCallExtensions;
  const realtimeOutboxTest = options.realtime ? renderSqliteRealtimeOutboxTest(database, options.realtime) : undefined;
  if (realtimeOutboxTest) files["api/tests/realtime-outbox-transaction.test.ts"] = realtimeOutboxTest;
  const dataflowTest = renderSqliteDataflowTest(database, options.dataflows ?? [], roles, options.actions ?? [], options.realtime !== undefined, permissions, deliveryTargets);
  if (dataflowTest) {
    files["api/tests/dataflow.test.ts"] = dataflowTest;
    const failureFlows = (options.dataflows ?? []).map((flow) => {
      const mutations = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "create" || action.kind === "delete");
      const mutation = mutations.at(-1);
      if (mutation) {
        const creation = mutation.kind === "create" ? mutation : flow.steps.flatMap((step) => step.actions).find((action) => action.kind === "create" && action.context === mutation.context);
        return { ...flow, steps: [...flow.steps, { name: "qiyTestLateFailure", order: Math.max(...flow.steps.map((step) => step.order)) + 1, actions: [{ kind: "require" as const, left: `${mutation.context}.id`, operator: creation ? "==" as const : "!=" as const, right: creation ? "00000000-0000-4000-8000-000000000000" : "00000000-0000-4000-8000-000000000001", error: "qiy.test.lateFailure" }] }] };
      }
      const updates = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "update");
      const last = updates.at(-1);
      if (!last) return flow;
      const value = last.values.at(-1)!;
      const binding = flow.context.find((context) => context.name === last.context)!;
      const input = value.source === "input" ? flow.input.find((field) => field.name === value.value) : undefined;
      const numericInput = input?.type === "Integer" || database.enums?.some((enumeration) => enumeration.name === input?.type);
      return { ...flow, steps: [...flow.steps, { name: "qiyTestLateFailure", order: Math.max(...flow.steps.map((step) => step.order)) + 1, actions: [{ kind: "require" as const, left: `${last.context}.${numericInput ? binding.id.split(":")[0] : value.field}`, operator: "!=" as const, right: numericInput ? "00000000-0000-4000-8000-000000000001" : value.source === "input" ? "Qiy fixture reason" : value.value, error: "qiy.test.lateFailure" }] }] };
    });
    files["api/tests/fixtures/dataflow-failure.ts"] = renderDataflowRoutes(database, failureFlows, options.scopes ?? [], [], options.realtime !== undefined, permissions)!
      .replaceAll('"../db"', '"../../src/db"').replaceAll('"../schema"', '"../../src/schema"').replaceAll('"../auth/guard"', '"../../src/auth/guard"').replaceAll('"../auth/permissions"', '"../../src/auth/permissions"').replaceAll('"./calls"', '"../../src/dataflows/calls"');
  }
  const scenarioTest = renderQiyScenarioTest(database, options.dataflows ?? [], roles, options.testSuite, permissions, deliveryTargets);
  if (scenarioTest) files["api/tests/qiy-scenarios.test.ts"] = scenarioTest;
  files["api/src/storage/index.ts"] = files["api/src/storage/index.ts"]!.replaceAll("__QIY_STORAGE_PROVIDER__", options.storageProvider ?? "local");
  files["api/src/storage/routes.ts"] = files["api/src/storage/routes.ts"]!.replace("__QIY_UPLOAD_POLICIES__", JSON.stringify(Object.fromEntries(database.entities.flatMap((entity) => entity.fields.filter((field) => field.type === "File" || field.type === "Files").map((field) => [`${entity.tableName}.${field.name}`, { mode: field.uploadMode ?? "binary", maxBytes: field.maxBytes ?? 25 * 1024 * 1024, mimeTypes: field.mimeTypes ?? ["*/*"], maxFiles: field.type === "Files" ? field.maxFiles ?? 6 : 1 }]))), null, 2));
  files["api/tests/storage.test.ts"] = files["api/tests/storage.test.ts"]!
    .replace("__QIY_STORAGE_TEST_FUNCTION__", uploadField ? "test" : "test.skip")
    .replace("__QIY_STORAGE_TEST_RESOURCE__", uploadField?.entity.tableName ?? "missing")
    .replace("__QIY_STORAGE_TEST_FIELD__", uploadField?.field.name ?? "missing")
    .replace("__QIY_STORAGE_TEST_MIME__", uploadField?.field.mimeTypes?.find((mime) => !mime.endsWith("/*") && mime !== "*/*") ?? (uploadField?.field.mimeTypes?.find((mime) => mime.endsWith("/*"))?.replace("*", "qiy-test") ?? "application/octet-stream"));
  if (database.dialect === "sqlite") {
    files["api/tests/storage-metadata.test.ts"] = `import { expect, test } from "bun:test";
import "./setup";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createStorageRoutes, cleanupMissingAttachmentObjects } from "../src/storage/routes";

${uploadField ? "test" : "test.skip"}("database attachment removal revokes reads and cleanup defaults to dry run", async () => {
  const previous = Bun.env.QIY_STORAGE_METADATA;
  Bun.env.QIY_STORAGE_METADATA = "database";
  const key = "metadata/" + crypto.randomUUID() + ".txt";
  try {
    client.exec('CREATE TABLE IF NOT EXISTS attachments (id text primary key, storageKey text unique not null, fileName text, contentType text not null, size integer not null, ownerId text, resource text not null, resourceId text, createdAt integer not null)');
    const app = new Elysia().use(createStorageRoutes(async () => ({ id: "metadata-owner", name: "Owner", role: ${JSON.stringify(roles.admin)}, claims: {} })));
    const url = "http://localhost/api/v1/files?key=" + key + "&resource=" + ${JSON.stringify(uploadField?.entity.tableName ?? "missing")} + "&field=" + ${JSON.stringify(uploadField?.field.name ?? "missing")};
    expect((await app.handle(new Request(url, { method: "POST", body: new Blob(["metadata test"], { type: ${JSON.stringify(uploadField?.field.mimeTypes?.find((mime) => !mime.endsWith("/*") && mime !== "*/*") ?? "application/octet-stream")} }) }))).status).toBe(200);
    client.query("DELETE FROM attachments WHERE storageKey = ?").run(key);
    expect((await app.handle(new Request(url))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/api/v1/files/metadata?key=" + key))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/api/v1/files/signed?key=" + key))).status).toBe(404);
    expect((await app.handle(new Request(url, { method: "DELETE" }))).status).toBe(200);
    const missingKey = "missing/" + crypto.randomUUID() + ".txt";
    client.query("INSERT INTO attachments (id, storageKey, contentType, size, resource, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), missingKey, "text/plain", 1, "test", Date.now());
    expect((await cleanupMissingAttachmentObjects()).dryRun).toBe(true);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(missingKey)).toBeTruthy();
    expect((await cleanupMissingAttachmentObjects({ dryRun: false })).dryRun).toBe(false);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(missingKey)).toBeNull();
  } finally {
    if (previous === undefined) delete Bun.env.QIY_STORAGE_METADATA; else Bun.env.QIY_STORAGE_METADATA = previous;
  }
});
`;
  }
  if (options.storageProvider === "s3") {
    files["api/tests/storage-config.test.ts"] = `import { expect, test } from "bun:test";
import { createStorageFromEnv } from "../src/storage";

test("S3 default fails closed without a bucket while tests can explicitly use local storage", () => {
  const provider = Bun.env.QIY_STORAGE_PROVIDER;
  const bucket = Bun.env.QIY_S3_BUCKET;
  try {
    delete Bun.env.QIY_STORAGE_PROVIDER;
    delete Bun.env.QIY_S3_BUCKET;
    expect(() => createStorageFromEnv()).toThrow("S3 bucket is required");
    Bun.env.QIY_STORAGE_PROVIDER = "local";
    expect(createStorageFromEnv().signedUrl("files/example.txt")).toBeNull();
  } finally {
    if (provider === undefined) delete Bun.env.QIY_STORAGE_PROVIDER; else Bun.env.QIY_STORAGE_PROVIDER = provider;
    if (bucket === undefined) delete Bun.env.QIY_S3_BUCKET; else Bun.env.QIY_S3_BUCKET = bucket;
  }
});
`;
  }
  files["api/src/storage/cleanup.ts"] = `import { cleanupMissingAttachmentObjects } from "./routes";

const dryRun = !Bun.argv.includes("--apply");
const result = await cleanupMissingAttachmentObjects({ dryRun, limit: Number(Bun.env.QIY_ATTACHMENT_CLEANUP_LIMIT ?? 1000) });
console.log(JSON.stringify(result));
`;
  files["api/src/storage/orphans.ts"] = `import { scanOrphanAttachmentObjects } from "./routes";

const dryRun = !Bun.argv.includes("--apply");
const limit = Number(Bun.env.QIY_ATTACHMENT_ORPHAN_LIMIT ?? 1000);
try {
  const result = await scanOrphanAttachmentObjects({ dryRun, limit });
  console.log(JSON.stringify(result));
  if (result.orphans.length) console.log("orphan objects: " + result.orphans.join(", "));
  if (result.truncated) console.log("more orphans exist than the --limit/retention window; re-run after applying");
  if (result.missingObjects) console.log("metadata rows without an object: " + result.missingObjects + " (run attachments:cleanup to remove them)");
  if (dryRun && result.orphans.length) console.log("dry run: nothing was deleted. Re-run with --apply after reviewing the list.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
  if (apiKeysEnabled && auth) {
    files["api/src/auth/api-key-hash.ts"] = renderApiKeyHashModule();
    files["api/src/auth/api-keys.ts"] = renderApiKeyRoutesModule(auth, database, apiKeyScopeClaimLines);
    files["api/tests/api-keys.test.ts"] = renderApiKeyTestModule(auth, database);
  }
  if (docsModelEnabled) {
    files["api/src/docs.ts"] = renderDocsModule(database, { ...options, features: { ...features, overview: overviewRequested } }, options.appName);
    files["api/src/docs-routes.ts"] = renderDocsRoutesModule(Boolean(permissions), apiDocsEnabled, docsModelEnabled);
    files["api/tests/docs.test.ts"] = renderDocsTestModule(database, apiDocsEnabled, docsModelEnabled);
  }
  if (auth) addAuthFiles(files, { database, options, auth, permissions, roles, hybridAuth, multiProviderAuth, singleOidcAuth, hasLocalAuth });
  for (const entity of database.entities) {
    const moduleRoot = `api/src/modules/${entity.name}`;
    const realtimeSubscription = options.realtime?.resources.find((subscription) => subscription.resource === entity.name || subscription.resource === entity.tableName);
    const realtimeEvents = new Set(realtimeSubscription?.events ?? []);
    const realtimeMasked = realtimeSubscription ? maskedRealtimeFields(normalizedRestrictions.find((restriction) => restriction.resource === entity.name), realtimeSubscription.roles) : [];
    const realtimeClaim = realtimeSubscription?.claim;
    const hiddenFields = hasLocalAuth && entity.name === options.auth!.userEntity ? [options.auth!.passwordField!] : [];
    const publicEntity = hiddenFields.length ? { ...entity, fields: entity.fields.filter((field) => !hiddenFields.includes(field.name)) } : entity;
    const entityRestricted = normalizedRestrictions.some((restriction) => restriction.resource === entity.name);
    const generatedEntityFields = generatedFieldsOf(publicEntity, database.relations ?? []);
    const generatedRepositoryImport = generatedEntityFields.length ? 'import { qiyCreateWithGeneratedValues, type QiyGeneratedField } from "../../generated-values";\n' : "";
    const generatedRepositoryDeclaration = generatedEntityFields.length ? `const qiyGeneratedFields = ${JSON.stringify(generatedFieldSpecs(publicEntity, database))} as QiyGeneratedField[];\n` : "";
    files[`${moduleRoot}/${entity.name}.repository.ts`] = `import { and, asc, avg, count, desc, eq, gt, gte, isNotNull, isNull, lt, lte, max, min, sql, sum, ${database.dialect === "postgresql" ? "ilike" : "like"}, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { ${entity.name}, auditEvents${repositoryLinkImports(publicEntity, database).map((name) => ", " + name).join("")}${realtimeSubscription ? ", realtimeOutbox" : ""}${resolveScopeTree(scopedDatabase, publicEntity) && resolveScopeTree(scopedDatabase, publicEntity)!.table.name !== entity.name ? `, ${resolveScopeTree(scopedDatabase, publicEntity)!.table.name}` : ""} } from "../../schema";
import type { FilterClause, FilterExpression, ${modelName(entity)}Repository as ${modelName(entity)}RepositoryContract } from "./${entity.name}.contract";
${entityRestricted ? 'import { QiyPolicyError, type QiyPolicy } from "../../security/policy";' : ""}
${publicEntity.fields.some((field) => field.version) ? 'import { QiyVersionConflict } from "../../concurrency";\n' : ""}${manyRelations(database, entity.name).length ? 'import { qiyAttachLinks, qiyLinkedSources, qiySplitLinks, qiyWriteLinks, type QiyLink } from "../../relation-links";\n' : ""}${generatedRepositoryImport}${realtimeMasked.length ? `\n// Every role that may subscribe has one of these fields masked, so the shared\n// channel must not carry them.\nfunction qiyRealtimePayload(record: Record<string, unknown>): Record<string, unknown> {\n  const safe = { ...record };\n  for (const field of ${JSON.stringify(realtimeMasked)}) delete safe[field];\n  return safe;\n}\n` : ""}
${generatedRepositoryDeclaration}${renderRepositoryLinks(publicEntity, database, options.scopes ?? [])}${renderScopeTreeHelper(scopedDatabase, publicEntity)}const notDeleted = ${publicEntity.fields.find((field) => field.softDelete) ? `isNull(${entity.name}.${publicEntity.fields.find((field) => field.softDelete)!.name})` : "undefined"};\nconst qiyBase${modelName(entity)}Repository: ${modelName(entity)}RepositoryContract = {
${renderRepositoryMethods(publicEntity, scopedDatabase, realtimeEvents, entityRestricted, realtimeMasked, realtimeClaim)}
};
${renderComputedRepository(publicEntity, `qiyBase${modelName(entity)}Repository`)}${renderLinkedRepository(publicEntity, database, `${modelName(entity)}RepositoryContract`, publicEntity.fields.some((field) => field.computed !== undefined) ? "qiyComputedRepository" : `qiyBase${modelName(entity)}Repository`)}
export const ${modelName(entity)}Repository: ${modelName(entity)}RepositoryContract = ${manyRelations(database, entity.name).length ? "qiyLinkedRepository" : publicEntity.fields.some((field) => field.computed !== undefined) ? "qiyComputedRepository" : `qiyBase${modelName(entity)}Repository`};
`;
    files[`${moduleRoot}/${entity.name}.contract.ts`] = `${generatedDocumentation(entity)}${entityRestricted ? 'import type { QiyPolicy } from "../../security/policy";\n' : ""}export interface ${modelName(entity)}Repository {
  distribution(field: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ value: string | null; count: number }>>;
  grouped?(groupBy: string, metric: string, operator: "sum" | "avg" | "min" | "max", scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ value: string | null; count: number }>>;
  /** Optional so generated test doubles and hand-written repositories keep compiling. */
  aggregate?(field: string, operator: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<{ value: number | null; operator: string }>;
  trend(field: string, days: number, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  create(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown>>;
  update(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<Record<string, unknown>>>;
  /** Clears the @softDelete marker; only soft-deleted resources implement it. */
  restore?(id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  /** Optional so test doubles and hand-written repositories keep working. */
  recordExportAudit?(input: { rows: number; filters: number; principalId?: string }): Promise<void>;
  recordImportAudit?(input: { rows: number; principalId?: string }): Promise<void>;
}

export type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
export interface FilterClause { field: string; operator: FilterOperator; value: string; }
export interface FilterGroup { operator: "and" | "or"; filters: FilterExpression[]; }
export type FilterExpression = FilterClause | FilterGroup;

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string> | FilterExpression[];
  scope?: { field: string; value: string };
  /** Lists soft-deleted rows instead of live ones (ignored without @softDelete). */
  deleted?: boolean;
${entityRestricted ? "  policy?: QiyPolicy;" : ""}
}
`;
    const temporalFields = temporalFieldsOf(entity);
    const temporalImport = temporalFields.length ? 'import { normalizeTemporalValues } from "../../temporal";\n' : "";
    const temporalDeclaration = temporalFields.length ? `const temporalFields = ${JSON.stringify(Object.fromEntries(temporalFields))} as Record<string, "Date" | "Time">;\n` : "";
    const fieldRules = entityFieldRules(entity.fields);
    const ruled = Object.keys(fieldRules).length > 0;
    const checkRules = (expression: string) => ruled ? `qiyCheckFieldRules(${expression})` : expression;
    const normalizeWrite = (expression: string) => temporalFields.length ? `normalizeDates(normalizeTemporalValues(${checkRules(expression)}, temporalFields))` : `normalizeDates(${checkRules(expression)})`;
    // Generated fields are never written from a request body: create strips the
    // client values before the repository fills them, and update strips them so a
    // PATCH of only generated fields is a documented no-op.
    const generatedServiceImport = generatedEntityFields.length ? 'import { qiyStripGeneratedValues, type QiyGeneratedField } from "../../generated-values";\n' : "";
    const generatedServiceDeclaration = generatedEntityFields.length ? `const qiyGeneratedFields = ${JSON.stringify(generatedFieldSpecs(publicEntity, database))} as QiyGeneratedField[];\n` : "";
    const createValues = generatedEntityFields.length ? "qiyStripGeneratedValues(values, qiyGeneratedFields)" : "values";
    const scopedArgs = `scope${entityRestricted ? ", policy" : ""}`;
    const createEntry = realtimeEvents.has("created")
      ? `async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const record = await repository.create(${normalizeWrite(createValues)}, actorId, ${scopedArgs}); await dispatchCommitted(); return record; }`
      : `(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.create(${normalizeWrite(createValues)}, actorId, ${scopedArgs})`;
    const updateSignature = `(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""})`;
    const updateEntry = !generatedEntityFields.length
      ? realtimeEvents.has("updated")
        ? `async ${updateSignature} => { const record = await repository.update(id, ${normalizeWrite("values")}, actorId, ${scopedArgs}); if (record) await dispatchCommitted(); return record; }`
        : `${updateSignature} => repository.update(id, ${normalizeWrite("values")}, actorId, ${scopedArgs})`
      : realtimeEvents.has("updated")
        ? `async ${updateSignature} => {
      const prepared = ${normalizeWrite("qiyStripGeneratedValues(values, qiyGeneratedFields)")};
      if (Object.keys(prepared).length === 0) return repository.one(id, ${scopedArgs});
      const record = await repository.update(id, prepared, actorId, ${scopedArgs});
      if (record) await dispatchCommitted();
      return record;
    }`
        : `async ${updateSignature} => {
      const prepared = ${normalizeWrite("qiyStripGeneratedValues(values, qiyGeneratedFields)")};
      if (Object.keys(prepared).length === 0) return repository.one(id, ${scopedArgs});
      return repository.update(id, prepared, actorId, ${scopedArgs});
    }`;
    files[`${moduleRoot}/${entity.name}.service.ts`] = `${temporalImport}${ruled ? 'import { checkFieldRules, type QiyFieldRules } from "../../field-rules";\n' : ""}${entityRestricted ? 'import type { QiyPolicy } from "../../security/policy";\n' : ""}${generatedServiceImport}import type { ${modelName(entity)}Repository, ListQuery } from "./${entity.name}.contract";
 ${realtimeSubscription ? 'import { pollRealtimeOutbox } from "../../realtime";' : ""}
${temporalDeclaration}${generatedServiceDeclaration}${ruled ? `const fieldRules = ${JSON.stringify(fieldRules)} as Record<string, QiyFieldRules>;\nfunction qiyCheckFieldRules(values: Record<string, unknown>): Record<string, unknown> {\n  checkFieldRules(values, fieldRules);\n  return values;\n}\n` : ""}const dateFields = ${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 ${realtimeSubscription ? `async function dispatchCommitted(): Promise<void> {
   try { await pollRealtimeOutbox(); }
   catch (error) { console.error("Realtime outbox read failed after committed mutation", { resource: ${JSON.stringify(entity.tableName)}, error }); }
}` : ""}
${generatedDocumentation(entity)}export function create${modelName(entity)}Service(repository: ${modelName(entity)}Repository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.aggregate ? repository.aggregate(field, operator, scope${entityRestricted ? ", policy" : ""}) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.distribution(field, scope${entityRestricted ? ", policy" : ""}),
    trend: (field: string, days: number, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.trend(field, days, scope${entityRestricted ? ", policy" : ""}),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.one(id, scope${entityRestricted ? ", policy" : ""}),
    create: ${createEntry},
    update: ${updateEntry},
    delete: ${realtimeEvents.has("deleted") ? `async (id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const record = await repository.delete(id, actorId, ${scopedArgs}); if (record) await dispatchCommitted(); return record; }` : `(id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.delete(id, actorId, ${scopedArgs})`},
    deleteMany: ${realtimeEvents.has("deleted") ? `async (ids: string[], actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const records = await repository.deleteMany(ids, actorId, scope${entityRestricted ? ", policy" : ""}); if (records.length) await dispatchCommitted(); return records; }` : `(ids: string[], actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.deleteMany(ids, actorId, scope${entityRestricted ? ", policy" : ""})`},${entity.fields.some((field) => field.softDelete) ? `
    restore: async (id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const record = await repository.restore?.(id, actorId, ${scopedArgs});${realtimeEvents.has("updated") ? " if (record) await dispatchCommitted();" : ""} return record; },` : ""}
  };
}
`;
    files[`${moduleRoot}/${entity.name}.routes.ts`] = `import { Elysia, t } from "elysia";
import type { Authenticator${entityRestricted ? "" : ", Principal"} } from "../../auth/guard";
import { QIY_DEFAULT_ROLE, hasFullAccess, isQiyRole } from "../../auth/roles";
${temporalFields.length ? 'import { QiyTemporalValueError } from "../../temporal";\n' : ""}${Object.keys(entityFieldRules(entity.fields)).length ? 'import { QiyFieldRuleError } from "../../field-rules";\n' : ""}${entity.fields.some((field) => field.version) ? 'import { QiyVersionConflict } from "../../concurrency";\n' : ""}${manyRelations(database, entity.name).length ? 'import { QiyRelationLinkError } from "../../relation-links";\n' : ""}${generatedEntityFields.length ? 'import { QiyGeneratedValueConflict } from "../../generated-values";\n' : ""}import { create${modelName(entity)}Service } from "./${entity.name}.service";
import { claimImportJob, createImportJob, isImportJobCancelled, listImportJobs, readImportJob, releaseStaleImportJobs, requestImportJobCancel, updateImportJob } from "../../import-jobs";
import { claimExportJob, createExportJob, listExportJobs, readExportJob, updateExportJob } from "../../export-jobs";
import type { ${modelName(entity)}Repository as ${modelName(entity)}RepositoryPort } from "./${entity.name}.contract";
${entityRestricted ? 'import { QiyPolicyError, resolvePolicy, type QiyPolicy } from "../../security/policy";\nimport { ' + entity.name + ' } from "../../schema";\nimport type { Principal } from "../../auth/guard";\n' : ""}
${renderRoutes(publicEntity, database, options.scopes, hiddenFields, entityRestricted, temporalFields.length ? "QiyTemporalValueError" : "", Object.keys(entityFieldRules(entity.fields)).length > 0).replace(`repository: ${modelName(entity)}Repository`, `repository: ${modelName(entity)}RepositoryPort`).replace("  return new Elysia({", `  const service = create${modelName(entity)}Service(repository);\n  return new Elysia({`).replaceAll("repository.list(", "service.list(").replaceAll("repository.one(", "service.one(").replaceAll("repository.create(", "service.create(").replaceAll("repository.update(", "service.update(").replaceAll("repository.delete(", "service.delete(")}`;
    files[`api/src/routes/${entity.name}.ts`] = `export { ${modelName(entity)}Routes } from "../modules/${entity.name}/${entity.name}.routes";\nexport type { ${modelName(entity)}Repository } from "../modules/${entity.name}/${entity.name}.contract";\n`;
    files[`api/tests/${entity.name}.test.ts`] = renderRouteTest(publicEntity, database, options.scopes ?? [], hiddenFields);
  }
  files["api/tests/graphql.test.ts"] = renderGraphQLTest(scopedDatabase, hasLocalAuth && database.entities[0]!.name === options.auth!.userEntity ? [options.auth!.passwordField!] : []);
  files["api/tests/graphql-schema.test.ts"] = `import { expect, test } from "bun:test";
import { buildSchema, isObjectType, isInputObjectType, validateSchema } from "graphql";
import { graphqlTypeDefs } from "../src/graphql";

test("generated GraphQL schema satisfies the GraphQL type system", () => {
  expect(validateSchema(buildSchema(graphqlTypeDefs)).map((error) => error.message)).toEqual([]);
});
${database.entities.map((entity) => {
    const hidden = hasLocalAuth && options.auth!.userEntity === entity.name ? [options.auth!.passwordField!] : [];
    const fields = entity.fields.filter((field) => field.comment !== undefined && !hidden.includes(field.name));
    if (entity.comment === undefined && !fields.length) return "";
    return `\ntest(${JSON.stringify(`${entity.name} GraphQL descriptions match the model`)}, () => {
  const schema = buildSchema(graphqlTypeDefs);
  for (const typeName of ${JSON.stringify([modelName(entity), `${modelName(entity)}CreateInput`, `${modelName(entity)}UpdateInput`])}) {
    const type = schema.getType(typeName);
    if (!isObjectType(type) && !isInputObjectType(type)) throw new Error("Missing documented GraphQL type");
    ${entity.comment !== undefined ? `expect(type.description).toBe(${JSON.stringify(entity.comment)});` : ""}
    ${fields.map((field) => `${field.primaryKey ? `if (isObjectType(type)) ` : ""}expect(type.getFields()[${JSON.stringify(field.name)}]?.description).toBe(${JSON.stringify(field.comment)});`).join("\n    ")}
  }
});\n`;
  }).join("")}
`;
  const graphqlListOptionsTest = renderGraphQLListOptionsTest(scopedDatabase);
  if (graphqlListOptionsTest) files["api/tests/graphql-list-options.test.ts"] = graphqlListOptionsTest;
  if (options.elysiaPlugins?.graphqlAdapter === "yoga" || options.elysiaPlugins?.graphqlAdapter === "apollo") {
    const policyFree = rowPolicyFree(database, options.restrictions ?? []);
    const adapterScope = (options.scopes ?? []).filter((scope) => policyFree(scope.resource)).map((scope) => ({
      scope,
      entity: database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource),
    })).find((entry) => entry.entity);
    const adapterEntity = adapterScope?.entity ?? database.entities.find((entity) => policyFree(entity.name)) ?? database.entities[0]!;
    const adapterScopeValue = adapterScope?.entity?.fields.find((field) => field.name === adapterScope.scope.field)?.type === "UUID"
      ? "00000000-0000-4000-8000-000000000002"
      : "Example";
    const adapterRecord = Object.fromEntries(adapterEntity.fields.map((field) => {
      if (field.nullable && !field.primaryKey) return [field.name, null];
      const value = ruleSample(field) ?? (field.enumName ? database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? ""
        : field.type === "Integer" ? 1
          : field.type === "Decimal" || field.type === "Money" ? "1.00"
            : field.type === "DateTime" ? "2026-10-06T00:00:00.000Z"
              : field.type === "Date" ? "2026-11-30"
                : field.type === "Time" ? "08:30:00"
                  : field.type === "UUID" ? "00000000-0000-4000-8000-000000000002"
                  : field.type === "Vector" ? Array(field.dimension).fill(0)
                  : field.type === "Files" ? ["uploads/sample.pdf"]
                    : "Example");
      return [field.name, value];
    }));
    const providerSortField = adapterEntity.fields.find((field) => field.sortable !== false && !field.primaryKey) ?? adapterEntity.fields.find((field) => field.sortable !== false)!;
    const providerFilterField = adapterEntity.fields.find((field) => field.filterable !== false && !field.primaryKey)!;
    const providerFilterValue = providerFilterField.enumName
      ? database.enums?.find((enumeration) => enumeration.name === providerFilterField.enumName)?.values[0]?.name ?? ""
        : providerFilterField.type === "Integer" ? "1"
          : "Example";
    const providerCreateValues = Object.fromEntries(adapterEntity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable).map((field) => [field.name, adapterRecord[field.name]]));
    const disabledSort = database.entities.flatMap((entity) => entity.fields.filter((field) => field.sortable === false).map((field) => ({ entity, field })))[0];
    const disabledFilter = database.entities.flatMap((entity) => entity.fields.filter((field) => field.filterable === false).map((field) => ({ entity, field })))[0];
    files["api/tests/graphql-adapter.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { createGraphQLDataProvider } from "../../web/app/data-provider";

test("official GraphQL adapter mounts the public endpoint and preserves authorization", async () => {
  const seenScopes: Array<{ field: string; value: string } | undefined> = [];
  const seenLists: Array<{ page: number; pageSize: number; options?: { search?: string; sort?: string; order?: string; filters?: Record<string, string> | Array<{ field: string; operator: string; value: string }>; scope?: { field: string; value: string } } }> = [];
  const seenMutations: Array<{ operation: string; actorId?: string; scope?: { field: string; value: string } }> = [];
  const repository = { distribution: async () => [], trend: async () => [], list: async (page: number, pageSize: number, options?: { search?: string; sort?: string; order?: "asc" | "desc"; filters?: Record<string, string> | Array<{ field: string; operator: "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in"; value: string }>; scope?: { field: string; value: string } }) => { seenScopes.push(options?.scope); seenLists.push({ page, pageSize, options }); return { data: [${JSON.stringify(adapterRecord)}], total: 1 }; }, one: async (_id: string, scope?: { field: string; value: string }) => { seenScopes.push(scope); return ${JSON.stringify(adapterRecord)}; }, create: async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "create", actorId, scope }); return { id: "00000000-0000-4000-8000-000000000001", ...values, ...(scope ? { [scope.field]: scope.value } : {}) }; }, update: async (_id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "update", actorId, scope }); return { ...${JSON.stringify(adapterRecord)}, ...values }; }, delete: async (_id: string, actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "delete", actorId, scope }); return ${JSON.stringify(adapterRecord)}; }, deleteMany: async (_ids: string[], actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "deleteMany", actorId, scope }); return [${JSON.stringify(adapterRecord)}]; } };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "adapter-user", name: "Adapter User", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }), false);
  expect(app.routes.some((route) => route.path === "/graphql" && route.method === "POST")).toBe(true);
  const browserPage = await app.handle(new Request("http://localhost/graphql"));
  expect(browserPage.status).toBe(405);
  expect(browserPage.headers.get("content-type")).not.toContain("text/html");
  const response = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${adapterEntity.name} { total } }" }) }));
  expect(response.status).toBe(200);
  expect((await response.json() as { data: Record<string, { total: number }> }).data.${adapterEntity.name}.total).toBe(1);
${adapterScope ? `  expect(seenScopes.at(-1)).toEqual({ field: ${JSON.stringify(adapterScope.scope.field)}, value: ${JSON.stringify(adapterScopeValue)} });
  const provider = createGraphQLDataProvider(async (input, init) => app.handle(new Request(new URL(String(input), "http://localhost"), init)));
  const providerResult = await provider.getList({ resource: ${JSON.stringify(adapterEntity.tableName)}, pagination: { currentPage: 2, pageSize: 25 }, sorters: [{ field: ${JSON.stringify(providerSortField.name)}, order: "desc" }], filters: [{ field: ${JSON.stringify(providerFilterField.name)}, operator: "eq", value: ${JSON.stringify(providerFilterValue)} }] });
  expect(providerResult).toEqual({ data: [${JSON.stringify(adapterRecord)}], total: 1 });
  expect(seenLists.at(-1)).toEqual({ page: 2, pageSize: 25, options: { search: undefined, sort: ${JSON.stringify(providerSortField.name)}, order: "desc", filters: [{ field: ${JSON.stringify(providerFilterField.name)}, operator: "eq", value: ${JSON.stringify(providerFilterValue)} }], scope: { field: ${JSON.stringify(adapterScope.scope.field)}, value: ${JSON.stringify(adapterScopeValue)} } } });
  const providerOne = await provider.getOne({ resource: ${JSON.stringify(adapterEntity.tableName)}, id: "00000000-0000-4000-8000-000000000002" });
  expect(providerOne.data).toEqual(${JSON.stringify(adapterRecord)});
  const providerCreate = await provider.create({ resource: ${JSON.stringify(adapterEntity.tableName)}, variables: ${JSON.stringify(providerCreateValues)} });
  expect(providerCreate.data).toMatchObject(${JSON.stringify(providerCreateValues)});
  const providerUpdate = await provider.update({ resource: ${JSON.stringify(adapterEntity.tableName)}, id: "00000000-0000-4000-8000-000000000002", variables: { ${JSON.stringify(providerFilterField.name)}: ${JSON.stringify(providerFilterValue)} } });
  expect(providerUpdate.data[${JSON.stringify(providerFilterField.name)}]).toBe(${JSON.stringify(providerFilterValue)});
  expect((await provider.deleteOne({ resource: ${JSON.stringify(adapterEntity.tableName)}, id: "00000000-0000-4000-8000-000000000002" })).data).toEqual(${JSON.stringify(adapterRecord)});
  expect((await provider.deleteMany?.({ resource: ${JSON.stringify(adapterEntity.tableName)}, ids: ["00000000-0000-4000-8000-000000000002"] }))?.data).toEqual([${JSON.stringify(adapterRecord)}]);
  expect(seenMutations.map(({ operation }) => operation)).toEqual(["create", "update", "delete", "deleteMany"]);
  expect(seenMutations.every(({ actorId, scope }) => actorId === "adapter-user" && scope?.field === ${JSON.stringify(adapterScope.scope.field)} && scope.value === ${JSON.stringify(adapterScopeValue)})).toBe(true);
  expect(seenScopes).toHaveLength(3);
  const oversizedPage = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query($pageSize: Int) { ${adapterEntity.name}(pageSize: $pageSize) { total } }", variables: { pageSize: 101 } }) }));
  expect((await oversizedPage.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);
${disabledSort ? `  const rejectedSort = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query($sort: String) { ${disabledSort.entity.name}(sort: $sort) { total } }", variables: { sort: ${JSON.stringify(disabledSort.field.name)} } }) }));
  expect((await rejectedSort.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);` : ""}
${disabledFilter ? `  const rejectedFilter = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query($filters: [QiyFilterInput!]) { ${disabledFilter.entity.name}(filters: $filters) { total } }", variables: { filters: [{ field: ${JSON.stringify(disabledFilter.field.name)}, value: "x" }] } }) }));
  expect((await rejectedFilter.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);` : ""}
  const mutation = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { delete${modelName(adapterEntity)}(id: \\"00000000-0000-4000-8000-000000000001\\") { id } }" }) }));
  expect(mutation.status).toBe(200);
  expect(seenMutations.map(({ operation }) => operation)).toEqual(["create", "update", "delete", "deleteMany", "delete"]);
  const missingClaim = await createApp(repositories, async () => ({ id: "adapter-user", name: "Adapter User", role: ${JSON.stringify(roles.admin)}, claims: {} }), false);
  const denied = await missingClaim.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${adapterEntity.name} { total } }" }) }));
  expect((await denied.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);
  expect(seenMutations).toHaveLength(5);` : ""}
  const anonymous = await createApp(repositories, async () => null, false);
  expect((await anonymous.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${adapterEntity.name} { total } }" }) }))).status).toBe(401);
});
`;
  }
  const dataScopeTest = renderDataScopeTest(database, options.scopes ?? [], options.restrictions ?? []);
  if (dataScopeTest) files["api/tests/data-scope.test.ts"] = dataScopeTest;
  const sqliteScopeTest = renderSqliteScopeTest(database, options.scopes ?? []);
  if (sqliteScopeTest) files["api/tests/sqlite-scope.test.ts"] = sqliteScopeTest;
  const sqliteVersionTest = renderSqliteVersionTest(database);
  if (sqliteVersionTest) files["api/tests/sqlite-version.test.ts"] = sqliteVersionTest;
  const distributionEntity = database.entities.find((entity) => entity.fields.some((field) => field.enumName));
  if (options.elysiaPlugins?.graphqlAdapter === "yoga" || options.elysiaPlugins?.graphqlAdapter === "apollo") {
    const policyFree = rowPolicyFree(database, options.restrictions ?? []);
    const analyticsEntity = database.entities.find((entity) =>
      policyFree(entity.name)
      && (options.scopes ?? []).some((scope) => scope.resource === entity.name || scope.resource === entity.tableName)
      && entity.fields.some((field) => field.enumName || field.type === "DateTime"),
    ) ?? database.entities.find((entity) => policyFree(entity.name) && entity.fields.some((field) => field.enumName || field.type === "DateTime"));
    if (analyticsEntity) {
      const distributionField = analyticsEntity.fields.find((field) => field.enumName);
      const trendField = analyticsEntity.fields.find((field) => field.type === "DateTime");
      const scope = options.scopes?.find((item) => item.resource === analyticsEntity.name || item.resource === analyticsEntity.tableName);
      const scopeValue = scope && analyticsEntity.fields.find((field) => field.name === scope.field)?.type === "UUID"
        ? "00000000-0000-4000-8000-000000000002" : "Example";
      files["api/tests/graphql-adapter-analytics.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { createGraphQLDataProvider } from "../../web/app/data-provider";

test("official GraphQL analytics match REST and enforce data scope", async () => {
  const seen: Array<{ operation: string; field: string; days?: number; scope?: { field: string; value: string } }> = [];
  const distributionRows = [{ value: ${JSON.stringify(distributionField ? database.enums?.find((item) => item.name === distributionField.enumName)?.values[0]?.name ?? "draft" : "draft")}, count: 2 }];
  const trendRows = [{ day: "2026-10-06", count: 2 }];
  const repository = {
    distribution: async (field: string, scope?: { field: string; value: string }) => { seen.push({ operation: "distribution", field, scope }); return distributionRows; },
    trend: async (field: string, days: number, scope?: { field: string; value: string }) => { seen.push({ operation: "trend", field, days, scope }); return trendRows; },
    list: async () => ({ data: [], total: 0 }), one: async () => undefined,
    create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [],
  };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "analytics-admin", name: "Admin", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }), false);
  const provider = createGraphQLDataProvider(async (input, init) => app.handle(new Request(new URL(String(input), "http://localhost"), init)));
${distributionField ? `  const distributionRest = await app.handle(new Request("http://localhost/api/v1/${analyticsEntity.tableName}/distribution?field=${distributionField.name}"));
  expect(distributionRest.status).toBe(200);
  const distribution = await provider.custom?.({ url: "/api/v1/${analyticsEntity.tableName}/distribution", method: "get", query: { field: "${distributionField.name}" } });
  expect(distribution?.data.items).toEqual(await distributionRest.json());
  expect(seen.at(-1)).toEqual({ operation: "distribution", field: "${distributionField.name}", scope: ${scope ? `{ field: ${JSON.stringify(scope.field)}, value: ${JSON.stringify(scopeValue)} }` : "undefined"} });
  const invalidDistribution = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${analyticsEntity.name}Distribution(field: \\"id\\") { value count } }" }) }));
  expect((await invalidDistribution.json() as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  expect(seen).toHaveLength(2);` : ""}
${trendField ? `  const trendRest = await app.handle(new Request("http://localhost/api/v1/${analyticsEntity.tableName}/trend?field=${trendField.name}&days=30"));
  expect(trendRest.status).toBe(200);
  const trend = await provider.custom?.({ url: "/api/v1/${analyticsEntity.tableName}/trend", method: "get", query: { field: "${trendField.name}", days: 30 } });
  expect(trend?.data.items).toEqual(await trendRest.json());
  expect(seen.at(-1)).toEqual({ operation: "trend", field: "${trendField.name}", days: 30, scope: ${scope ? `{ field: ${JSON.stringify(scope.field)}, value: ${JSON.stringify(scopeValue)} }` : "undefined"} });
  const invalidTrend = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${analyticsEntity.name}Trend(field: \\"${trendField.name}\\", days: 0) { day count } }" }) }));
  expect((await invalidTrend.json() as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  expect(seen).toHaveLength(${distributionField ? 4 : 2});` : ""}
${scope ? `  const missingClaim = await createApp(repositories, async () => ({ id: "analytics-admin", name: "Admin", role: ${JSON.stringify(roles.admin)}, claims: {} }), false);
  const denied = await missingClaim.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${analyticsEntity.name}${distributionField ? `Distribution(field: \\"${distributionField.name}\\") { value count }` : `Trend(field: \\"${trendField!.name}\\", days: 30) { day count }`} }" }) }));
  expect((await denied.json() as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  expect(seen).toHaveLength(${(distributionField ? 2 : 0) + (trendField ? 2 : 0)});` : ""}
});
`;
    }
  }
  if (distributionEntity) {
    const field = distributionEntity.fields.find((item) => item.enumName)!;
    files["api/tests/distribution.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL expose the full authorized enum distribution", async () => {
  const rows = [{ value: "draft", count: 150 }, { value: "approved", count: 100 }];
  const repository = { distribution: async () => rows, list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const viewer = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: ${JSON.stringify(roles.admin)}, claims: ${testClaims} }), false);
  const endpoint = "http://localhost/api/v1/${distributionEntity.tableName}/distribution?field=${field.name}";
  expect(await (await viewer.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await viewer.handle(new Request(endpoint.replace("${field.name}", "not_a_field")))).status).toBe(400);
  const graph = await viewer.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${distributionEntity.name}Distribution(field: \\"${field.name}\\") { value count } }" }) }));
  expect((await graph.json() as { data: { ${distributionEntity.name}Distribution: typeof rows } }).data.${distributionEntity.name}Distribution).toEqual(rows);
  const anonymous = await createApp(repositories, async () => null, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
});
`;
  }
  const trendEntity = database.entities.find((entity) => entity.fields.some((field) => field.type === "DateTime"));
  if (trendEntity) {
    const field = trendEntity.fields.find((item) => item.type === "DateTime")!;
    const scope = options.scopes?.find((item) => item.resource === trendEntity.name || item.resource === trendEntity.tableName);
    files["api/tests/trend.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL trend uses the authorized data scope", async () => {
  const rows = [{ day: "2026-10-06", count: 3 }];
  const seen: unknown[] = [];
  const repository = { trend: async (_field: string, _days: number, scope?: unknown) => { seen.push(scope); return rows; }, distribution: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const principal = { id: "admin", name: "Admin", role: ${JSON.stringify(roles.admin)} as const, claims: ${JSON.stringify(scope ? { [scope.claim]: "tenant-a" } : {})} };
  const app = await createApp(repositories, async () => principal, false);
  const endpoint = "http://localhost/api/v1/${trendEntity.tableName}/trend?field=${field.name}&days=30";
  expect(await (await app.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await app.handle(new Request(endpoint.replace("${field.name}", "missing")))).status).toBe(400);
  expect((await app.handle(new Request(endpoint.replace("days=30", "days=366")))).status).toBe(422);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${trendEntity.name}Trend(field: \\"${field.name}\\", days: 30) { day count } }" }) }));
  expect(graph.status).toBe(200);
  expect((await graph.json() as { data: { ${trendEntity.name}Trend: typeof rows } }).data.${trendEntity.name}Trend).toEqual(rows);
  expect(seen).toEqual(${scope ? '[{ field: "' + scope.field + '", value: "tenant-a" }, { field: "' + scope.field + '", value: "tenant-a" }]' : '[undefined, undefined]'});
  const anonymous = await createApp(repositories, async () => null, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
${scope ? `  const missing = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: ${JSON.stringify(roles.admin)} }), false);
  expect((await missing.handle(new Request(endpoint))).status).toBe(403);
  const deniedGraph = await missing.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${trendEntity.name}Trend(field: \\"${field.name}\\", days: 30) { day } }" }) }));
  if (deniedGraph.status === 200) expect((await deniedGraph.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  else expect(deniedGraph.status).toBe(403);
  expect(seen).toHaveLength(2);
` : ""}});
`;
  }
  if (database.dialect === "sqlite") {
    const entity = database.entities[0]!;
    const entityGenerated = generatedFieldsOf(entity, database.relations ?? []);
    const columns = entity.fields.filter((field) => field.computed === undefined).map((field) => `"${field.name}" ${field.type === "Integer" || field.type === "DateTime" ? "integer" : field.type === "Decimal" || field.type === "Money" ? "real" : "text"}${field.primaryKey ? " primary key" : ""}${!field.nullable && !field.primaryKey ? " not null" : ""}`).join(", ");
    const values = entity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable).map((field) => `${JSON.stringify(field.name)}: ${field.enumName ? JSON.stringify(database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name) : field.type === "Integer" ? "1" : field.type === "Boolean" ? "true" : field.type === "Array" ? (field.itemType === "Integer" ? "[1]" : '["Example"]') : field.type === "Decimal" || field.type === "Money" ? '"1.00"' : field.type === "DateTime" ? 'new Date("2026-01-01T00:00:00.000Z")' : field.type === "Date" ? '"2026-11-30"' : field.type === "Time" ? '"08:30:00"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"' : field.type === "Files" ? '["uploads/sample.pdf"]' : field.type === "Email" ? '"user@example.com"' : field.type === "URL" ? '"https://example.com"' : '"Example"'}`).join(", ");
    // A generated @code field allocates from the sequence table before the insert,
    // so the rollback fixture has to provide it.
    const sequenceTable = entityGenerated.some((generated) => generated.kind === "code")
      ? ' CREATE TABLE IF NOT EXISTS "qiy_code_sequences" ("entity" text not null, "field" text not null, "bucket" text not null, "value" integer not null, primary key ("entity", "field", "bucket"));'
      : "";
    files["api/tests/audit.test.ts"] = `import { expect, test } from "bun:test";

test("SQLite CRUD audit rolls back the mutation when the audit insert fails", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { ${modelName(entity)}Repository } = await import("../src/modules/${entity.name}/${entity.name}.repository");
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS "audit_events"; DROP TABLE IF EXISTS "qiy_code_sequences"; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE "audit_events" ("id" text primary key, "actorId" text, "action" text not null, "resource" text not null, "resourceId" text, "metadata" text, "createdAt" integer not null);${sequenceTable}`)});
  const actorId = "00000000-0000-4000-8000-000000000001";
  const values = { ${values} };
  const created = await ${modelName(entity)}Repository.create(values, actorId);
  expect(created.id).toBeTruthy();
  expect(client.query<{ action: string; actorId: string }, []>("select action, actorId from audit_events").get()).toEqual({ action: "${entity.tableName}.created", actorId });
  client.exec("DROP TABLE audit_events");
  await expect(${modelName(entity)}Repository.create(values, actorId)).rejects.toThrow();
  expect(client.query<{ total: number }, []>("select count(*) as total from ${entity.tableName}").get()?.total).toBe(1);
});
`;
  }
  const documentedFields = (entity: EntityIR) => entity.fields.filter((field) => !field.primaryKey && field.comment !== undefined && !(hasLocalAuth && entity.name === options.auth!.userEntity && field.name === options.auth!.passwordField));
  const describedEntities = database.entities.filter((entity) => entity.comment !== undefined || documentedFields(entity).length);
  const describedDataflows = (options.dataflows ?? []).filter((flow) => flow.label !== undefined || flow.comment !== undefined);
  if (describedEntities.length || describedDataflows.length) {
    files["api/tests/documentation.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("publishes model descriptions in the actual OpenAPI request schemas", async () => {
  const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories);
  const response = await app.handle(new Request("http://localhost/api/v1/openapi/json"));
  expect(response.status).toBe(200);
  const specification = await response.json();
  const expected: Array<{ resource: string; description?: string; fields: Record<string, string> }> = ${JSON.stringify(describedEntities.map((entity) => ({ resource: entity.tableName, description: entity.comment, fields: Object.fromEntries(documentedFields(entity).map((field) => [field.name, field.comment])) })))};
  for (const entity of expected) {
    for (const method of ["post", "patch"]) {
      const path = "/api/v1/" + entity.resource + (method === "post" ? "/" : "/{id}");
      const original = specification.paths[path][method].requestBody.content["application/json"].schema;
      const schema = original.$ref ? specification.components.schemas[original.$ref.split("/").at(-1)] : original;
      if (entity.description !== undefined) expect(schema.description).toBe(entity.description);
      for (const [name, description] of Object.entries(entity.fields)) expect(schema.properties[name].description).toBe(description);
    }
  }
  const dataflows: Array<{ name: string; summary: string; description: string }> = ${JSON.stringify(describedDataflows.map((flow) => ({ name: flow.name, summary: flow.label ?? flow.name, description: flow.comment ?? flow.label ?? flow.name })))};
  for (const flow of dataflows) {
    const operation = specification.paths["/api/v1/commands/" + flow.name].post;
    expect(operation.summary).toBe(flow.summary);
    expect(operation.description).toBe(flow.description);
    expect(operation.tags).toContain("Dataflow");
  }
});
`;
  }
  if (auth) {
    Object.assign(files, generateAudit(database, auth, options.scopes));
    const userTable = database.entities.find((entity) => entity.name === auth.userEntity)!.tableName;
    files["api/src/auth/roles.ts"] = renderRolesModule(options.auth);
    files["api/src/auth/guard.ts"] = files["api/src/auth/guard.ts"]!.replace('resource.path === "users"', `resource.path === ${JSON.stringify(userTable)}`);
  }
  // Generated values (business codes and UUIDs) share one server runtime and one
  // generated test file for REST, GraphQL and CSV import.
  if (usesGeneratedValues(database)) {
    files["api/src/generated-values.ts"] = renderGeneratedValuesModule(database);
    const generatedValuesTest = renderGeneratedValuesTest(database);
    if (generatedValuesTest) files["api/tests/generated-values.test.ts"] = generatedValuesTest;
  }
  return files;
}

