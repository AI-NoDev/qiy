/**
 * Server renderers for Dataflow routes, their idempotency/outbox tables,
 * call contracts and the generated Dataflow and scenario tests.
 */
import { renderDeliveryInsert, sqliteDeliveryDdl } from "../delivery";
import type { DatabaseIR, EntityIR, FieldIR } from "../database-ir";
import type { QiyProject, DataflowIR } from "../qiy-project";
import { declaredPermissionValues, isPermissionModelEmpty, requiredPermissionValues, type QiyPermissionModel } from "../permissions";
import { resolveQiyTestValue, type QiyTestSuite, type QiyTestScenario } from "../qiy-test";
import type { RoleContext } from "../roles";
import { generatedDocumentation } from "../generated-documentation";
import { dataflowGraphqlName } from "./graphql";
import { sqliteColumnType, sqliteTestDefault } from "./sqlite-tests";

export function dataflowInputField(type: string): string {
  switch (type) {
    case "UUID": return 't.String({ format: "uuid" })';
    case "Text": return "t.String({ minLength: 1 })";
    case "Email": return "t.String({ format: \"email\", minLength: 3 })";
    case "URL": return "t.String({ format: \"uri\", minLength: 4 })";
    case "JSON": return "t.Any()";
    case "Integer": return "t.Integer({ minimum: -2147483648, maximum: 2147483647 })";
    case "Decimal": return 't.String({ pattern: "^-?[0-9]+(\\\\.[0-9]+)?$" })';
    case "Boolean": return "t.Boolean()";
    default: throw new Error(`Unsupported dataflow input type ${type}`);
  }
}

export function renderDataflowIdempotencySchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const actor = dialect === "mysql" ? 'varchar("actorId", { length: 128 })' : 'text("actorId")';
  const flow = dialect === "mysql" ? 'varchar("flow", { length: 80 })' : 'text("flow")';
  const key = dialect === "mysql" ? 'varchar("requestKeyHash", { length: 64 })' : 'text("requestKeyHash")';
  return `\n\nexport const dataflowIdempotency = ${table}("dataflow_idempotency", {\n  id: ${dialect === "mysql" ? 'varchar("id", { length: 36 })' : 'text("id")'}.primaryKey(),\n  actorId: ${actor}.notNull(),\n  flow: ${flow}.notNull(),\n  requestKeyHash: ${key}.notNull(),\n  requestHash: text("requestHash").notNull(),\n  response: text("response").notNull(),\n}, (table) => [uniqueIndex("dataflow_idempotency_actor_flow_key_idx").on(table.actorId, table.flow, table.requestKeyHash)]);\n`;
}

export function renderDataflowOutboxSchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  return `\n\nexport const dataflowOutbox = ${table}("dataflow_outbox", {\n  id: ${dialect === "mysql" ? 'varchar("id", { length: 36 })' : 'text("id")'}.primaryKey(),\n  actorId: ${dialect === "mysql" ? 'varchar("actorId", { length: 128 })' : 'text("actorId")'},\n  event: ${dialect === "mysql" ? 'varchar("event", { length: 190 })' : 'text("event")'}.notNull(),\n  payload: text("payload").notNull(),\n  createdAt: ${dialect === "postgresql" ? 'timestamp("createdAt", { withTimezone: true })' : dialect === "sqlite" ? 'integer("createdAt", { mode: "timestamp" })' : 'datetime("createdAt", { mode: "date", fsp: 3 })'}.notNull(),\n});\n`;
}

export function dataflowCallAdapters(dataflows: NonNullable<QiyProject["dataflows"]>): string[] {
  return [...new Set(dataflows.flatMap((flow) => flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "call" ? [action.adapter] : [])))].sort();
}

export function renderDataflowCallContracts(dataflows: NonNullable<QiyProject["dataflows"]>): string | undefined {
  const adapters = dataflowCallAdapters(dataflows);
  if (!adapters.length) return undefined;
  return `import { dataflowCallHandlers } from "../extensions/dataflow-calls";

export type DataflowCallName = ${adapters.map((adapter) => JSON.stringify(adapter)).join(" | ")};
export interface DataflowCallRequest {
  flow: string;
  actor: { id: string; role: string };
  payload: Record<string, unknown>;
}
export type DataflowCallResult = { ok: true } | { ok: false; error: string; errorKey?: string };
export type DataflowCallHandlers = Record<DataflowCallName, (request: DataflowCallRequest) => DataflowCallResult>;

export function invokeDataflowCall(name: DataflowCallName, request: DataflowCallRequest): DataflowCallResult {
  return dataflowCallHandlers[name](request);
}
`;
}

export function renderDataflowCallExtensions(dataflows: NonNullable<QiyProject["dataflows"]>): string | undefined {
  const adapters = dataflowCallAdapters(dataflows);
  if (!adapters.length) return undefined;
  return `import type { DataflowCallHandlers } from "../dataflows/calls";

// This file is intentionally not owned by Qiy sync. Implement deterministic,
// synchronous local validation here. Async network calls and irreversible external
// side effects are forbidden inside the database transaction; write an outbox event
// with \`emit\` and deliver it after commit.
export const dataflowCallHandlers: DataflowCallHandlers = {
${adapters.map((adapter) => `  ${JSON.stringify(adapter)}: () => ({ ok: false, error: ${JSON.stringify(`Implement dataflow call adapter ${adapter}`)}, errorKey: "qiy.dataflow.call.notImplemented" }),`).join("\n")}
};
`;
}

export function renderDataflowRoutes(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, scopes: NonNullable<QiyProject["scopes"]> = [], qiyActions: NonNullable<QiyProject["actions"]> = [], realtimeEnabled = false, permissions?: QiyPermissionModel, deliveryTargets: Map<string, string[]> = new Map()): string | undefined {
  if (!dataflows.length) return undefined;
  const usesPermissions = dataflows.some((flow) => flow.permission || flow.verification);
  if (usesPermissions && !permissions) throw new Error("Dataflow permission rules require permission declarations");
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const scopeFor = (entity: EntityIR) => scopes.find((scope) => scope.resource === entity.name || scope.resource === entity.tableName);
  const synchronous = database.dialect === "sqlite";
  const selectOne = (query: string) => synchronous ? `${query}.get()` : `(await ${query})[0]`;
  const routeBlocks = dataflows.map((flow) => {
    const batchAction = qiyActions.find((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name);
    const createdBindings = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "create");
    const bindings = [
      ...flow.context.map((binding) => ({ name: binding.name, entity: binding.entity })),
      ...createdBindings.map((action) => ({ name: action.context, entity: action.entity })),
    ];
    const contextNames = new Map(bindings.map((binding, index) => [binding.name, `context${index}`]));
    const entityByBinding = new Map(bindings.map((binding) => [binding.name, binding.entity]));
    const scopedEntities = [...new Set(bindings.map((binding) => binding.entity))].flatMap((name) => {
      const entity = entities.get(name)!;
      const scope = scopeFor(entity);
      return scope ? [{ entity, scope }] : [];
    });
    const scopeVariables = new Map(scopedEntities.map(({ entity }, index) => [entity.name, `dataScope${index}`]));
    const scopeSetup = scopedEntities.map(({ scope }, index) => `      const dataScope${index} = principal?.claims?.[${JSON.stringify(scope.claim)}];
      if (dataScope${index} === undefined || dataScope${index} === null || dataScope${index} === "") return status(403, { error: "Missing required data scope claim: " + ${JSON.stringify(scope.claim)} });`).join("\n");
    const inputSchema = flow.input.map((field) => {
      const enumeration = database.enums?.find((item) => item.name === field.type);
      if (enumeration) {
        const schema = `t.Union([${enumeration.values.map((value) => `t.Literal(${JSON.stringify(value.name)})`).join(", ")}], ${JSON.stringify(field.comment ? { description: field.comment } : {})})`;
        return `${generatedDocumentation(field, "      ")}      ${JSON.stringify(field.name)}: ${field.required ? schema : `t.Optional(${schema})`},`;
      }
      const base = dataflowInputField(field.type);
      const described = field.comment ? (base.includes("({") ? base.replace("({", `({ description: ${JSON.stringify(field.comment)},`) : base.replace("()", `({ description: ${JSON.stringify(field.comment)} })`)) : base;
      return `${generatedDocumentation(field, "      ")}      ${JSON.stringify(field.name)}: ${field.required ? described : `t.Optional(${described})`},`;
    }).join("\n");
    const contextLoads = flow.context.map((binding, index) => {
      const entity = entities.get(binding.entity);
      if (!entity) throw new Error(`Dataflow ${flow.name}: unknown entity ${binding.entity}`);
      const [key, source] = binding.id.split(":", 2);
      const inputName = source?.replace(/^input\./, "");
      if (!key || !inputName) throw new Error(`Dataflow ${flow.name}: invalid context source ${binding.id}`);
      const scope = scopeFor(entity);
      const scopeVariable = scopeVariables.get(entity.name);
      const condition = scope
        ? `and(eq(${entity.name}[${JSON.stringify(key)}], body[${JSON.stringify(inputName)}]), eq(${entity.name}[${JSON.stringify(scope.field)}], String(${scopeVariable})))`
        : `eq(${entity.name}[${JSON.stringify(key)}], body[${JSON.stringify(inputName)}])`;
      return `${generatedDocumentation(binding, "        ")}        let context${index} = ${selectOne(`tx.select().from(${entity.name}).where(${condition}).limit(1)${synchronous ? "" : '.for("update")'}`)};\n        if (!context${index}) throw new DataflowFailure(404, "Not found", ${JSON.stringify(entity.tableName)});`;
    }).join("\n\n");
    const actionCode = flow.steps.flatMap((step) => step.actions).map((action, actionIndex) => {
      if (action.kind === "require") {
        const [binding, field] = action.left.split(".", 2);
        const variable = binding === "input" ? "body" : contextNames.get(binding!);
        if (!variable || !field) throw new Error(`Dataflow ${flow.name}: invalid requirement ${action.left}`);
        return `        if (!(${variable}[${JSON.stringify(field)}] ${action.operator} ${JSON.stringify(action.right)})) throw new DataflowFailure(409, ${JSON.stringify(action.error)}${action.errorKey ? `, undefined, ${JSON.stringify(action.errorKey)}` : ""});`;
      }
      if (action.kind === "update") {
        const entityName = entityByBinding.get(action.context);
        const entity = entityName ? entities.get(entityName) : undefined;
        const variable = contextNames.get(action.context);
        if (!entity || !variable) throw new Error(`Dataflow ${flow.name}: invalid update context ${action.context}`);
        const versionField = entity.fields.find((field) => field.version)?.name;
        const values = `{ ${[...action.values.map((value) => `${JSON.stringify(value.field)}: ${value.source === "input" ? `body[${JSON.stringify(value.value)}]` : JSON.stringify(value.value)}`), ...(versionField ? [`${JSON.stringify(versionField)}: ${variable}.${versionField} + 1`] : [])].join(", ")} }`;
        const where = `eq(${entity.name}.id, ${variable}.id)`;
        const update = database.dialect === "sqlite"
          ? `const updated = tx.update(${entity.name}).set(${values}).where(${where}).returning().get();\n        if (!updated) return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} };\n        ${variable} = updated;`
          : database.dialect === "mysql"
            ? `await tx.update(${entity.name}).set(${values}).where(${where});\n        const updated = (await tx.select().from(${entity.name}).where(${where}).limit(1))[0];\n        if (!updated) return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} };\n        ${variable} = updated;`
            : `const updated = (await tx.update(${entity.name}).set(${values}).where(${where}).returning())[0];\n        if (!updated) return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} };\n        ${variable} = updated;`;
        return `        {\n        ${update.replaceAll(`return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} }`, `throw new DataflowFailure(404, "Not found", ${JSON.stringify(entity.tableName)})`)}\n        }`;
      }
      if (action.kind === "create") {
        const entity = entities.get(action.entity);
        const variable = contextNames.get(action.context);
        if (!entity || !variable) throw new Error(`Dataflow ${flow.name}: invalid create context ${action.context}`);
        const scope = scopeFor(entity);
        const scopeVariable = scopeVariables.get(entity.name);
        const values = [
          `id: crypto.randomUUID()`,
          ...action.values.map((value) => `${JSON.stringify(value.field)}: ${value.source === "input" ? `body[${JSON.stringify(value.value)}]` : JSON.stringify(value.value)}`),
          ...(scope ? [`${JSON.stringify(scope.field)}: String(${scopeVariable})`] : []),
        ].join(", ");
        if (database.dialect === "sqlite") return `        let ${variable} = tx.insert(${entity.name}).values({ ${values} } as typeof ${entity.name}.$inferInsert).returning().get();\n        if (!${variable}) throw new DataflowFailure(409, "Unable to create", ${JSON.stringify(entity.tableName)});`;
        if (database.dialect === "mysql") {
          const id = `created${actionIndex}Id`;
          const mysqlValues = values.replace("id: crypto.randomUUID()", `id: ${id}`);
          return `        const ${id} = crypto.randomUUID();\n        await tx.insert(${entity.name}).values({ ${mysqlValues} } as typeof ${entity.name}.$inferInsert);\n        let ${variable} = (await tx.select().from(${entity.name}).where(eq(${entity.name}.id, ${id})).limit(1))[0];\n        if (!${variable}) throw new DataflowFailure(409, "Unable to create", ${JSON.stringify(entity.tableName)});`;
        }
        return `        let ${variable} = (await tx.insert(${entity.name}).values({ ${values} } as typeof ${entity.name}.$inferInsert).returning())[0];\n        if (!${variable}) throw new DataflowFailure(409, "Unable to create", ${JSON.stringify(entity.tableName)});`;
      }
      if (action.kind === "emit") {
        const payloadFields = (action.payload ?? []).map((value) => {
          if (value.source === "literal") return `${JSON.stringify(value.name)}: ${JSON.stringify(value.value)}`;
          if (value.source === "input") return `${JSON.stringify(value.name)}: body[${JSON.stringify(value.value)}]`;
          const variable = contextNames.get(value.context!);
          if (!variable) throw new Error(`Dataflow ${flow.name}: invalid emit context ${value.context}`);
          return `${JSON.stringify(value.name)}: ${variable}[${JSON.stringify(value.value)}]`;
        });
        const payload = `JSON.stringify({ flow: ${JSON.stringify(flow.name)}${payloadFields.length ? `, ${payloadFields.join(", ")}` : ""} })`;
        const insert = `tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: ${JSON.stringify(action.event)}, payload: ${payload}, createdAt: new Date() })`;
        const realtimeInsert = `tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: ${JSON.stringify(`qiy:event:${action.event}`)}, type: ${JSON.stringify(action.event)}, payload: ${payload}, createdAt: new Date() })`;
        const targets = deliveryTargets.get(action.event) ?? [];
        const deliveries = targets.length ? `\n${renderDeliveryInsert(database.dialect, targets, action.event, payload)}` : "";
        return `        ${database.dialect === "sqlite" ? `${insert}.run();${realtimeEnabled ? `\n        ${realtimeInsert}.run();` : ""}` : `await ${insert};${realtimeEnabled ? `\n        await ${realtimeInsert};` : ""}`}${deliveries}`;
      }
      if (action.kind === "call") {
        const payloadFields = (action.payload ?? []).map((value) => {
          if (value.source === "literal") return `${JSON.stringify(value.name)}: ${JSON.stringify(value.value)}`;
          if (value.source === "input") return `${JSON.stringify(value.name)}: body[${JSON.stringify(value.value)}]`;
          const variable = contextNames.get(value.context!);
          if (!variable) throw new Error(`Dataflow ${flow.name}: invalid call context ${value.context}`);
          return `${JSON.stringify(value.name)}: ${variable}[${JSON.stringify(value.value)}]`;
        });
        return `        {
          const callResult = invokeDataflowCall(${JSON.stringify(action.adapter)}, { flow: ${JSON.stringify(flow.name)}, actor: { id: principal.id, role: principal.role }, payload: { ${payloadFields.join(", ")} } });
          if (!callResult.ok) throw new DataflowFailure(409, callResult.error, undefined, callResult.errorKey);
        }`;
      }
      const entityName = entityByBinding.get(action.context);
      const entity = entityName ? entities.get(entityName) : undefined;
      const variable = contextNames.get(action.context);
      if (!entity || !variable) throw new Error(`Dataflow ${flow.name}: invalid delete context ${action.context}`);
      const deletion = database.dialect === "sqlite"
        ? `tx.delete(${entity.name}).where(eq(${entity.name}.id, ${variable}.id)).run();`
        : `await tx.delete(${entity.name}).where(eq(${entity.name}.id, ${variable}.id));`;
      return `        ${deletion}`;
    });
    let actionOffset = 0;
    const actions = flow.steps.map((step) => {
      const code = actionCode.slice(actionOffset, actionOffset + step.actions.length).join("\n");
      actionOffset += step.actions.length;
      return generatedDocumentation(step, "        ") + code;
    }).join("\n");
    const result = contextNames.get(flow.result);
    if (!result) throw new Error(`Dataflow ${flow.name}: missing result context ${flow.result}`);
    const resultEntityName = entityByBinding.get(flow.result);
    const resultEntity = resultEntityName ? entities.get(resultEntityName) : undefined;
    if (!resultEntity) throw new Error(`Dataflow ${flow.name}: missing result entity ${flow.result}`);
    const needsIdempotency = flow.idempotency?.required === true;
    const requestSetup = needsIdempotency ? `      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\\x21-\\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([${[...flow.input.map((field) => `body[${JSON.stringify(field.name)}]`), ...scopeVariables.values()].join(", ")} ]));
` : "";
    const transactionReplay = needsIdempotency ? `        const previous = ${selectOne(`tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(flow.name)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1)`)};
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };
` : "";
    const auditWrite = flow.audit === undefined ? "" : `        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: ${JSON.stringify(flow.audit)}, resource: ${JSON.stringify(resultEntity.tableName)}, resourceId: String(value.id), metadata: ${database.dialect === "sqlite" ? 'JSON.stringify({ flow: ' + JSON.stringify(flow.name) + ' })' : '{ flow: ' + JSON.stringify(flow.name) + ' }'}, createdAt: ${database.dialect === "sqlite" || database.dialect === "postgresql" ? "new Date()" : "Date.now()"} });
`;
    const receiptWrite = needsIdempotency ? `        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(flow.name)}, requestKeyHash, requestHash, response: JSON.stringify(value) });
` : "";
    const catchReplay = needsIdempotency ? `      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(flow.name)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
` : "      } catch (error) { if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) }); throw error; }\n";
    const permissionSetup = flow.permission || flow.verification ? "      const permissionSnapshot = await loadPermissions(principal);\n" : "";
    const declaredVerification = flow.verification ? permissions?.verifications.find((candidate) => candidate.name === flow.verification) : undefined;
    const verificationInputs = declaredVerification
      ? `{ ${declaredVerification.inputs.map((input) => `${JSON.stringify(input.name)}: ${input.type === "Text" ? `String(body[${JSON.stringify(input.name)}])` : `[String(body[${JSON.stringify(input.name)}])]`}`).join(", ")} }`
      : "{}";
    const authorizationCheck = flow.permission
      ? `${permissionSetup}      const requiredPermissions = ${JSON.stringify(requiredPermissionValues(permissions!, flow.permission))};
      const missingPermissions = requiredPermissions.filter((permission) => !permissionSnapshot.permissions.includes(permission));
      if (missingPermissions.length > 0) return status(403, { error: "Missing required permissions: " + missingPermissions.join(", "), errorKey: "command.forbidden", missing: missingPermissions });`
      : flow.verification
        ? `${permissionSetup}      const permissionVerdict = evaluatePermissionVerification(${JSON.stringify(flow.verification)}, { ...permissionSnapshot, role: principal.role }, ${verificationInputs});
      if (!permissionVerdict.found) return status(403, { error: "Unknown permission verification ${flow.verification}" });
      if ("error" in permissionVerdict) return status(400, { error: permissionVerdict.error });
      if (!permissionVerdict.allowed) return status(403, { error: "Permission verification ${flow.verification} denied this command", errorKey: "command.forbidden", ...(permissionVerdict.missing.length ? { missing: permissionVerdict.missing } : {}) });`
        : `      if (!${JSON.stringify(flow.roles!)}.includes(principal.role)) return status(403, { error: "Command execution is restricted" });`;
    const singleRoute = `${generatedDocumentation(flow, "    ")}    .post(${JSON.stringify(`/${flow.name}`)}, async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
${authorizationCheck}
${scopeSetup ? `${scopeSetup}\n` : ""}${requestSetup}      let outcome;
      try {
      outcome = await db.transaction(${synchronous ? "" : "async "}(tx) => {
${transactionReplay}
${contextLoads}

${actions}

        const value = ${result};
${synchronous ? auditWrite.replace("await tx.insert", "tx.insert").replace(" });\n", " }).run();\n") : auditWrite}${synchronous ? receiptWrite.replace("await tx.insert", "tx.insert").replace(" });\n", " }).run();\n") : receiptWrite}        return { kind: "ok" as const, value };
      });
${catchReplay}${needsIdempotency ? `      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });
` : ""}
      return outcome.value;
    }, { body: t.Object({
${inputSchema}
    }, { additionalProperties: false }), detail: { summary: ${JSON.stringify(flow.label ?? flow.name)}, description: ${JSON.stringify(flow.comment ?? flow.label ?? flow.name)}, tags: ["Dataflow"] } })`;
    if (!batchAction) return singleRoute;
    if (!needsIdempotency) throw new Error(`Batch action ${batchAction.name}: dataflow ${flow.name} must require idempotency`);
    const batchEntity = database.entities.find((entity) => entity.tableName === batchAction.resource || entity.name === batchAction.resource);
    const batchBinding = batchEntity ? flow.context.find((binding) => binding.entity === batchEntity.name) : undefined;
    const batchIdInput = batchBinding?.id.split(":", 2)[1]?.replace(/^input\./, "");
    if (!batchEntity || !batchBinding || !batchIdInput) throw new Error(`Batch action ${batchAction.name}: cannot resolve resource id input`);
    const batchFlowName = `${flow.name}:batch`;
    const batchTransactionReplay = `        const previous = ${selectOne(`tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(batchFlowName)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1)`)};
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };
`;
    const batchAuditWrite = synchronous
      ? auditWrite.replace("await tx.insert", "tx.insert").replace(" });\n", " }).run();\n")
      : auditWrite;
    const batchReceiptWrite = synchronous
      ? `        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(batchFlowName)}, requestKeyHash, requestHash, response: JSON.stringify(values) }).run();\n`
      : `        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(batchFlowName)}, requestKeyHash, requestHash, response: JSON.stringify(values) });\n`;
    const batchTopCheck = flow.verification
      ? `${permissionSetup}`
      : authorizationCheck;
    const batchVerificationCheck = flow.verification
      ? `                const batchPermissionVerdict = evaluatePermissionVerification(${JSON.stringify(flow.verification)}, { ...permissionSnapshot, role: principal.role }, ${verificationInputs});
                if (!batchPermissionVerdict.found || "error" in batchPermissionVerdict || !batchPermissionVerdict.allowed) throw new BatchDataflowFailure(403, "Permission verification ${flow.verification} denied this command", itemIndex, String(body[${JSON.stringify(batchIdInput)}]), undefined, "command.forbidden");
`
      : "";
    const batchRoute = `
    .post(${JSON.stringify(`/${flow.name}/batch`)}, async ({ body: batch, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
${batchTopCheck}
${scopeSetup ? `${scopeSetup}\n` : ""}      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\\x21-\\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const itemIds = batch.items.map((item) => String(item[${JSON.stringify(batchIdInput)}]));
      if (new Set(itemIds).size !== itemIds.length) return status(400, { error: "Batch item identifiers must be unique" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([batch.items, ${[...scopeVariables.values()].join(", ")} ]));
      let outcome;
      try {
        outcome = await db.transaction(${synchronous ? "" : "async "}(tx) => {
${batchTransactionReplay}          const values = [];
          for (let itemIndex = 0; itemIndex < batch.items.length; itemIndex += 1) {
            const body = batch.items[itemIndex]!;
            try {
${batchVerificationCheck}${contextLoads}

${actions}

              const value = ${result};
${batchAuditWrite}              values.push(value);
            } catch (error) {
              if (error instanceof DataflowFailure) throw new BatchDataflowFailure(error.status, error.message, itemIndex, String(body[${JSON.stringify(batchIdInput)}]), error.resource, error.errorKey);
              throw error;
            }
          }
${batchReceiptWrite}          return { kind: "ok" as const, value: values };
        });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal.id), eq(dataflowIdempotency.flow, ${JSON.stringify(batchFlowName)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof BatchDataflowFailure) return status(error.status, { error: error.message, item: { index: error.index, id: error.id }, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });
      return outcome.value;
    }, { body: t.Object({ items: t.Array(t.Object({
${inputSchema}
    }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }), detail: { summary: ${JSON.stringify(`Batch ${flow.label ?? flow.name}`)}, description: ${JSON.stringify(`Atomically execute ${flow.comment ?? flow.label ?? flow.name} for a selected collection`)}, tags: ["Dataflow"] } })`;
    return singleRoute + batchRoute;
  }).join("\n");
  const usesIdempotency = dataflows.some((flow) => flow.idempotency?.required);
  const usesAudit = dataflows.some((flow) => flow.audit !== undefined);
  const usesOutbox = dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit")));
  const usesRealtimeOutbox = realtimeEnabled && usesOutbox;
  const usesDeliveryRows = dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit" && deliveryTargets.has(action.event))));
  const usesCalls = dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "call")));
  const dataflowEntities = dataflows.flatMap((flow) => [
    ...flow.context.map((binding) => binding.entity),
    ...flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "create" ? [action.entity] : []),
  ]);
  return `import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
 import { ${[...new Set([...dataflowEntities, ...(usesIdempotency ? ["dataflowIdempotency"] : []), ...(usesAudit ? ["auditEvents"] : []), ...(usesOutbox ? ["dataflowOutbox"] : []), ...(usesRealtimeOutbox ? ["realtimeOutbox"] : []), ...(usesDeliveryRows ? ["qiyDeliveries"] : [])])].join(", ")} } from "../schema";
import type { Authenticator } from "../auth/guard";
${usesPermissions ? 'import { evaluatePermissionVerification, loadPermissions } from "../auth/permissions";\n' : ""}
${usesCalls ? 'import { invokeDataflowCall } from "./calls";\n' : ""}

class DataflowFailure extends Error {
  constructor(public readonly status: 403 | 404 | 409, message: string, public readonly resource?: string, public readonly errorKey?: string) { super(message); }
}

class BatchDataflowFailure extends DataflowFailure {
  constructor(status: 403 | 404 | 409, message: string, public readonly index: number, public readonly id: string, resource?: string, errorKey?: string) { super(status, message, resource, errorKey); }
}

${usesIdempotency ? `async function hashDataflowValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}` : ""}

export function createDataflowRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/commands" })
${routeBlocks};
}
`;
}

export function dataflowFixtureValue(field: FieldIR, requires: Array<{ field: string; operator: "==" | "!=" | ">" | ">=" | "<" | "<="; right: string | number }>, enums: DatabaseIR["enums"]): string {
  const requirement = requires.find((item) => item.field === field.name);
  const enumeration = enums?.find((item) => item.name === field.enumName);
  if (field.type === "Integer" && requirement) {
    const rules = requires.filter((item) => item.field === field.name && typeof item.right === "number");
    const candidates = [7, 1, 0, -2147483648, 2147483647, ...rules.flatMap((rule) => [Number(rule.right), Number(rule.right) + 1, Number(rule.right) - 1])];
    const value = candidates.find((candidate) => candidate >= -2147483648 && candidate <= 2147483647 && rules.every((rule) => {
      const bound = Number(rule.right);
      switch (rule.operator) {
        case "==": return candidate === bound;
        case "!=": return candidate !== bound;
        case ">": return candidate > bound;
        case ">=": return candidate >= bound;
        case "<": return candidate < bound;
        case "<=": return candidate <= bound;
      }
    }));
    if (value === undefined) throw new Error(`Cannot infer a successful Dataflow test fixture for Integer field ${field.name}: contradictory requirements`);
    return JSON.stringify(value);
  }
  if (enumeration) {
    const rules = requires.filter((item) => item.field === field.name);
    const value = enumeration.values.find((candidate) => rules.every((rule) => rule.operator === "==" ? candidate.name === rule.right : rule.operator !== "!=" || candidate.name !== rule.right));
    return JSON.stringify((value ?? enumeration.values[0]!).name);
  }
  if (requirement) return JSON.stringify(requirement.operator === "==" ? requirement.right : `${requirement.right}-before`);
  if (field.primaryKey || field.type === "UUID") return '"00000000-0000-4000-8000-000000000001"';
  if (field.type === "Email") return '"user@example.com"';
  if (field.type === "URL") return '"https://example.com"';
  if (field.enumName || field.type === "Text" || field.type === "File") return '"Qiy fixture"';
  if (field.type === "Files") return '["uploads/sample.pdf"]';
  if (field.type === "Integer") return "1";
  if (field.type === "Boolean") return "true";
  if (field.type === "Decimal" || field.type === "Money") return "1";
  if (field.type === "DateTime") return "new Date(0)";
  if (field.type === "Date") return '"2026-11-30"';
  if (field.type === "Time") return '"08:30:00"';
  return "null";
}

export function renderSqliteDataflowTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, roles: RoleContext, qiyActions: NonNullable<QiyProject["actions"]> = [], realtimeEnabled = false, permissions?: QiyPermissionModel, deliveryTargets: Map<string, string[]> = new Map()): string | undefined {
  if (database.dialect !== "sqlite" || !dataflows.length) return undefined;
  // Command authorization may be role-, permission- or verification-based. The
  // generated happy-path actor holds every declared permission so the fixture
  // input only has to satisfy the business rules, not the authorization model.
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const callAdapters = dataflowCallAdapters(dataflows);
  const usedEntities = [...new Set(dataflows.flatMap((flow) => [
    ...flow.context.map((binding) => binding.entity),
    ...flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "create" ? [action.entity] : []),
  ]))].map((name) => entities.get(name)!);
  const tenantClaims = [...new Set(usedEntities.flatMap((entity) => entity.fields.flatMap((field) => field.tenantClaim === undefined ? [] : [field.tenantClaim])))];
  const permissionPrincipal = (permissions && !isPermissionModelEmpty(permissions)
    ? `, permissions: ${JSON.stringify(declaredPermissionValues(permissions))}, groups: ${JSON.stringify(permissions.groups.map((group) => group.name))}`
    : "") + (tenantClaims.length ? `, claims: ${JSON.stringify(Object.fromEntries(tenantClaims.map((claim) => [claim, "00000000-0000-4000-8000-000000000001"])))}` : "");
  const imports = usedEntities.map((entity) => entity.name).join(", ");
  const schema = usedEntities.map((entity) => {
    const columns = entity.fields.filter((field) => field.computed === undefined).map((field) => `${JSON.stringify(field.columnName ?? field.name)} ${sqliteColumnType(field)}${sqliteTestDefault(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
    return `client.exec(${JSON.stringify(`CREATE TABLE IF NOT EXISTS ${entity.tableName} (${columns})`)});`;
  }).join("\n");
  const auxiliarySchema = [
    `client.exec("CREATE TABLE IF NOT EXISTS audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null)");`,
    ...(dataflows.some((flow) => flow.idempotency?.required) ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_idempotency (id text primary key, actorId text not null, flow text not null, requestKeyHash text not null, requestHash text not null, response text not null, UNIQUE(actorId, flow, requestKeyHash))");`] : []),
    ...(dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_outbox (id text primary key, actorId text, event text not null, payload text not null, createdAt integer not null)");`] : []),
    ...(realtimeEnabled && dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? [`client.exec("CREATE TABLE IF NOT EXISTS qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, createdAt integer not null)");`] : []),
    ...(deliveryTargets.size ? [`client.exec(${JSON.stringify(sqliteDeliveryDdl)});`] : []),
  ].join("\n");
  const cleanup = [
    ...usedEntities.map((entity) => `client.exec(${JSON.stringify(`DELETE FROM ${entity.tableName}`)});`),
    "client.exec('DELETE FROM audit_events');",
    ...(dataflows.some((flow) => flow.idempotency?.required) ? ["client.exec('DELETE FROM dataflow_idempotency');"] : []),
    ...(dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? ["client.exec('DELETE FROM dataflow_outbox');"] : []),
    ...(realtimeEnabled && dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? ["client.exec('DELETE FROM qiy_realtime_outbox');"] : []),
    ...(deliveryTargets.size ? ["client.exec('DELETE FROM qiy_deliveries');"] : []),
  ].join("\n");
  const tests = dataflows.map((flow) => {
    const input = Object.fromEntries(flow.input.map((field) => [field.name, database.enums?.find((item) => item.name === field.type)?.values.at(-1)?.name ?? (field.type === "UUID" ? "00000000-0000-4000-8000-000000000001" : field.type === "Text" ? "Qiy fixture reason" : field.type === "Integer" ? 7 : field.type === "Boolean" ? true : "1.00")]));
    for (const field of flow.input) {
      const requires = flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "require" && action.left === `input.${field.name}` ? [{ field: field.name, operator: action.operator, right: action.right }] : []);
      if (requires.length) input[field.name] = JSON.parse(dataflowFixtureValue({ name: field.name, type: field.type === "Integer" ? "Integer" : "Text", ...(database.enums?.some((item) => item.name === field.type) ? { enumName: field.type } : {}) }, requires, database.enums));
    }
    const seed = flow.context.map((binding) => {
      const entity = entities.get(binding.entity)!;
      const written = new Set<string>();
      const requires = flow.steps.flatMap((step) => step.actions).flatMap((action) => {
        if (action.kind === "update" && action.context === binding.name) action.values.forEach((value) => written.add(value.field));
        return action.kind === "require" && action.left.startsWith(`${binding.name}.`) && !written.has(action.left.slice(binding.name.length + 1)) ? [{ field: action.left.slice(binding.name.length + 1), operator: action.operator, right: action.right }] : [];
      });
      const values = entity.fields.map((field) => `${JSON.stringify(field.name)}: ${dataflowFixtureValue(field, requires, database.enums)}`).join(", ");
      return `await db.insert(${entity.name}).values({ ${values} } as any);`;
    }).join("\n    ");
    const flowActions = flow.steps.flatMap((step) => step.actions);
    const resultWrites = flowActions.flatMap((action) => (action.kind === "update" || action.kind === "create") && action.context === flow.result ? action.values : []);
    const finalWrites = new Map(resultWrites.map((write) => [write.field, write]));
    const assertions = [...finalWrites.values()].map((update) => `expect(result).toMatchObject({ ${JSON.stringify(update.field)}: ${JSON.stringify(update.source === "input" ? input[update.value] : update.value)} });`).join("\n    ");
    const resultCreateEntity = flowActions.flatMap((action) => action.kind === "create" && action.context === flow.result ? [action.entity] : []).at(0);
    const resultDeleted = flowActions.some((action) => action.kind === "delete" && action.context === flow.result);
    const resultEntityName = flow.context.find((binding) => binding.name === flow.result)?.entity ?? resultCreateEntity;
    const resultMutationCheck = resultCreateEntity && !resultDeleted
      ? `\n    expect(client.query("SELECT * FROM ${entities.get(resultCreateEntity)!.tableName} WHERE id = ?").get(result.id)).toBeTruthy();`
      : resultDeleted
        ? `\n    expect(client.query("SELECT * FROM ${entities.get(resultEntityName!)!.tableName} WHERE id = ?").get(result.id)).toBeNull();`
        : "";
    const headers = flow.idempotency?.required ? `{ "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }` : `{ "Content-Type": "application/json" }`;
    const missingKeyCheck = flow.idempotency?.required ? `    const missingKey = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(missingKey.status).toBe(400);` : "";
    const changedInput = flow.input.find((field) => field.type !== "UUID" && (database.enums?.find((item) => item.name === field.type)?.values.length ?? 2) > 1) ?? flow.input[0];
    const changedEnum = database.enums?.find((item) => item.name === changedInput?.type);
    const changedValue = changedEnum ? changedEnum.values.find((value) => value.name !== input[changedInput!.name])?.name : changedInput?.type === "UUID" ? "00000000-0000-4000-8000-000000000099" : changedInput?.type === "Boolean" ? false : changedInput?.type === "Integer" ? 2 : changedInput?.type === "Decimal" ? "2.00" : "different value";
    const graphqlName = dataflowGraphqlName(flow.name);
    const graphqlOperation = `run${graphqlName}`;
    const graphqlDeclarations = [flow.input.length ? `$input: ${graphqlName}CommandInput!` : undefined, flow.idempotency?.required ? "$key: String!" : undefined].filter((value): value is string => Boolean(value));
    const graphqlArguments = [flow.input.length ? "input: $input" : undefined, flow.idempotency?.required ? "idempotencyKey: $key" : undefined].filter((value): value is string => Boolean(value));
    const graphqlQuery = `mutation${graphqlDeclarations.length ? `(${graphqlDeclarations.join(", ")})` : ""} { ${graphqlOperation}${graphqlArguments.length ? `(${graphqlArguments.join(", ")})` : ""} { id } }`;
    const graphqlVariables = { ...(flow.input.length ? { input } : {}), ...(flow.idempotency?.required ? { key: `graphql-${flow.name}-key` } : {}) };
    const graphqlCommandTest = `
  test(${JSON.stringify(`${flow.name} executes through GraphQL with REST-equivalent idempotency`)}, async () => {
    ${seed}
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": ${JSON.stringify(flow.roles?.[0] ?? roles.admin)} }, body: JSON.stringify({ query: ${JSON.stringify(graphqlQuery)}, variables }) });
    const response = await graphqlApp.handle(request(${JSON.stringify(graphqlVariables)}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.[${JSON.stringify(graphqlOperation)}]?.id).toBeTruthy();
    ${flow.idempotency?.required ? `const replay = await graphqlApp.handle(request(${JSON.stringify(graphqlVariables)}));
    expect(await replay.json()).toEqual(payload);` : ""}
    ${flow.idempotency?.required && changedInput ? `const conflict = await graphqlApp.handle(request({ ...${JSON.stringify(graphqlVariables)}, input: { ...${JSON.stringify(input)}, ${JSON.stringify(changedInput.name)}: ${JSON.stringify(changedValue)} } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);` : ""}
  });`;
    const replayCheck = flow.idempotency?.required ? `
    const replay = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    ${changedInput ? `const changedPayload = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(changedInput.name)}: ${JSON.stringify(changedValue)} }) }));
    expect(changedPayload.status).toBe(409);` : ""}` : "";
    const auditCheck = flow.audit !== undefined ? `
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get(${JSON.stringify(flow.audit)})?.total).toBe(1);` : "";
    const emittedEvents = flow.steps.flatMap((step) => step.actions).filter((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "emit" }> => action.kind === "emit");
    const outboxCheck = emittedEvents.length ? `
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(${emittedEvents.length});
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe(${JSON.stringify(emittedEvents[0]!.event)});` : "";
    const deliveryCount = emittedEvents.reduce((total, action) => total + (deliveryTargets.get(action.event)?.length ?? 0), 0);
    const deliveryCheck = deliveryCount ? `
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_deliveries where status = 'pending'").get()?.total).toBe(${deliveryCount});` : "";
    const realtimeOutboxCheck = realtimeEnabled && emittedEvents.length ? `
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(${emittedEvents.length});
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: ${JSON.stringify(`qiy:event:${emittedEvents[0]!.event}`)}, type: ${JSON.stringify(emittedEvents[0]!.event)} });` : "";
    const firstCall = flow.steps.flatMap((step) => step.actions).find((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "call" }> => action.kind === "call");
    const callRollbackTest = firstCall ? `
  test(${JSON.stringify(`${flow.name} rolls back when call adapter ${firstCall.adapter} rejects`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const previous = dataflowCallHandlers[${JSON.stringify(firstCall.adapter)}];
    dataflowCallHandlers[${JSON.stringify(firstCall.adapter)}] = () => ({ ok: false, error: "Adapter rejected", errorKey: "adapter.rejected" });
    try {
      const rejected = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: "Adapter rejected", errorKey: "adapter.rejected" });
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    } finally { dataflowCallHandlers[${JSON.stringify(firstCall.adapter)}] = previous; }
  });` : "";
    const hasMutations = flow.steps.some((step) => step.actions.some((action) => action.kind === "update" || action.kind === "create" || action.kind === "delete" || action.kind === "emit"));
    const deniedRoles = flow.roles ? roles.names.filter((role) => !flow.roles!.includes(role)) : roles.readers;
    const authorizationTest = `
  test(${JSON.stringify(`${flow.name} rejects unauthenticated and disallowed roles before writing`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...${JSON.stringify(deniedRoles)}] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    }
  });`;
    const businessRollbackTest = hasMutations ? `
  test(${JSON.stringify(`${flow.name} rolls back earlier writes when a later requirement fails`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: ${JSON.stringify(flow.roles?.[0] ?? roles.admin)}${permissionPrincipal} })));
    const failed = await failureApp.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    ${realtimeEnabled && emittedEvents.length ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);' : ""}
  });` : "";
    const rollbackTests = [flow.audit !== undefined ? "audit_events" : undefined, flow.idempotency?.required ? "dataflow_idempotency" : undefined].filter((table): table is string => Boolean(table)).map((table) => `
  test(${JSON.stringify(`${flow.name} rolls back when ${table} insertion fails and allows retry`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    client.exec(${JSON.stringify(`CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)});
    try {
      const failed = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
      expect(failed.status).toBe(500);
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(retry.status).toBe(200);
  });`).join("\n");
    const inputValidationTests = flow.input.filter((field) => field.type === "Integer" || database.enums?.some((enumeration) => enumeration.name === field.type)).map((field) => `
  test(${JSON.stringify(`${flow.name} rejects invalid ${field.type} input ${field.name} without writes`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of ${JSON.stringify(field.type === "Integer" ? [-2147483649, 2147483648, 1.5, "invalid", null] : ["qiy-undeclared-enum-value", 7, null, {}])}) {
      const rejected = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(field.name)}: invalid }) }));
      expect(rejected.status).toBe(422);
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    }
  });`).join("\n");
    const numericGuardTests = flow.steps.flatMap((step) => step.actions).flatMap((action, index) => {
      if (action.kind !== "require" || !action.left.startsWith("input.") || typeof action.right !== "number") return [];
      const invalid = action.operator === ">" || action.operator === "<" || action.operator === "!=" ? action.right : action.operator === ">=" ? action.right - 1 : action.operator === "<=" ? action.right + 1 : action.right === 2147483647 ? action.right - 1 : action.right + 1;
      if (invalid < -2147483648 || invalid > 2147483647) return [];
      const field = action.left.slice("input.".length);
      return [`
  test(${JSON.stringify(`${flow.name} rejects numeric business rule ${index} without writes or receipts`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const rejected = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(field)}: ${invalid} }) }));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject(${JSON.stringify({ error: action.error, ...(action.errorKey ? { errorKey: action.errorKey } : {}) })});
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    ${action.errorKey ? `const graphFailure = await graphqlApp.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": ${JSON.stringify(flow.roles?.[0] ?? roles.admin)} }, body: JSON.stringify({ query: ${JSON.stringify(graphqlQuery)}, variables: { ...${JSON.stringify(graphqlVariables)}, input: { ...${JSON.stringify(input)}, ${JSON.stringify(field)}: ${invalid} } } }) }));
    const graphFailurePayload = await graphFailure.json() as { errors?: Array<{ extensions?: { status?: number; errorKey?: string } }> };
    expect(graphFailurePayload.errors?.[0]?.extensions).toMatchObject(${JSON.stringify({ status: 409, errorKey: action.errorKey })});` : ""}
    const retry = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(retry.status).toBe(200);
  });`];
    }).join("\n");
    const batchAction = qiyActions.find((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name);
    const batchBinding = batchAction ? flow.context.find((binding) => entities.get(binding.entity)?.tableName === batchAction.resource) : undefined;
    const batchEntity = batchBinding ? entities.get(batchBinding.entity) : undefined;
    const batchIdInput = batchBinding?.id.split(":", 2)[1]?.replace(/^input\./, "");
    const batchRequirement = batchBinding ? flow.steps.flatMap((step) => step.actions).find((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "require" }> => action.kind === "require" && action.left.startsWith(`${batchBinding.name}.`)) : undefined;
    const batchRequirementField = batchRequirement && batchEntity ? batchEntity.fields.find((field) => field.name === batchRequirement.left.slice(batchRequirement.left.indexOf(".") + 1)) : undefined;
    let batchFailureSetup = "";
    let batchFailureReset = "";
    if (batchEntity && batchRequirement && batchRequirementField) {
      const fieldRequirements = [{ field: batchRequirementField.name, operator: batchRequirement.operator, right: batchRequirement.right }];
      const valid = dataflowFixtureValue(batchRequirementField, fieldRequirements, database.enums);
      const invalid = typeof batchRequirement.right === "number"
        ? batchRequirement.operator === ">" ? batchRequirement.right : batchRequirement.operator === ">=" ? batchRequirement.right - 1 : batchRequirement.operator === "<" ? batchRequirement.right : batchRequirement.operator === "<=" ? batchRequirement.right + 1 : batchRequirement.operator === "==" ? batchRequirement.right + 1 : batchRequirement.right
        : batchRequirement.operator === "==" ? "__qiy_batch_invalid__" : batchRequirement.right;
      batchFailureSetup = `    client.query(${JSON.stringify(`UPDATE ${batchEntity.tableName} SET ${batchRequirementField.columnName ?? batchRequirementField.name} = ? WHERE id = ?`)}).run(${JSON.stringify(invalid)}, "00000000-0000-4000-8000-000000000002");\n`;
      batchFailureReset = `    client.query(${JSON.stringify(`UPDATE ${batchEntity.tableName} SET ${batchRequirementField.columnName ?? batchRequirementField.name} = ? WHERE id = ?`)}).run(${valid}, "00000000-0000-4000-8000-000000000002");\n`;
    }
    const batchTest = batchAction && batchBinding && batchEntity && batchIdInput ? `
  test(${JSON.stringify(`${flow.name} batch executes atomically with one persistent idempotency receipt`)}, async () => {
    ${seed}
    ${seed.replaceAll("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002")}
${batchFailureSetup}    const items = [
      { ...${JSON.stringify(input)}, ${JSON.stringify(batchIdInput)}: "00000000-0000-4000-8000-000000000001" },
      { ...${JSON.stringify(input)}, ${JSON.stringify(batchIdInput)}: "00000000-0000-4000-8000-000000000002" },
    ];
    const headers = { "Content-Type": "application/json", "Idempotency-Key": ${JSON.stringify(`batch-${flow.name}-key`)} };
    const request = (body: unknown, requestHeaders = headers) => app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}/batch`)}, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) }));
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table + " ORDER BY id").all());
    ${batchFailureSetup ? `const failed = await request({ items });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ item: { index: 1, id: "00000000-0000-4000-8000-000000000002" } });
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table + " ORDER BY id").all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
${batchFailureReset}` : ""}    const graphResponse = await graphqlApp.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": ${JSON.stringify(flow.roles?.[0] ?? roles.admin)} }, body: JSON.stringify({ query: ${JSON.stringify(`mutation($items: [${graphqlName}CommandInput!]!, $key: String!) { ${graphqlOperation}Batch(items: $items, idempotencyKey: $key) { id } }`)}, variables: { items, key: ${JSON.stringify(`batch-${flow.name}-key`)} } }) }));
    expect(graphResponse.status).toBe(200);
    const graphPayload = await graphResponse.json() as { data?: { ${graphqlOperation}Batch?: Array<{ id: unknown }> }; errors?: unknown[] };
    expect(graphPayload.errors).toBeUndefined();
    const result = graphPayload.data?.${graphqlOperation}Batch ?? [];
    expect(result).toHaveLength(2);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency WHERE flow = '" + ${JSON.stringify(`${flow.name}:batch`)} + "'").get()?.total).toBe(1);
    const replay = await request({ items });
    expect(replay.status).toBe(200);
    const replayResult = await replay.json() as Array<Record<string, unknown>>;
    expect(replayResult.map((record) => ({ id: record.id }))).toEqual(result);
    const conflict = await request({ items: [...items].reverse() });
    expect(conflict.status).toBe(409);
    const duplicate = await request({ items: [items[0], items[0]] }, { "Content-Type": "application/json", "Idempotency-Key": ${JSON.stringify(`batch-${flow.name}-duplicate`)} });
    expect(duplicate.status).toBe(400);
  });` : "";
    return `test(${JSON.stringify(flow.idempotency?.required ? "replays a successful command without a second audit event" : `${flow.name} returns not-found and commits its supported update`)}, async () => {
${missingKeyCheck}
    ${flow.context.length ? `const missing = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(missing.status).toBe(404);` : ""}
    ${seed}
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    ${assertions || "expect(result).toHaveProperty(\"id\");"}${resultMutationCheck}
    ${replayCheck}${auditCheck}${outboxCheck}${deliveryCheck}${realtimeOutboxCheck}
  });${graphqlCommandTest}${authorizationTest}${rollbackTests}${businessRollbackTest}${callRollbackTest}${inputValidationTests}${numericGuardTests}${batchTest}`;
  }).join("\n\n");
  return `import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client, db } from "../src/db";
import { ${imports} } from "../src/schema";
import { createDataflowRoutes } from "../src/dataflows";
import { QIY_ADMIN_ROLE, isQiyRole, type QiyRole } from "../src/auth/roles";
${callAdapters.length ? 'import { dataflowCallHandlers } from "../src/extensions/dataflow-calls";\n' : ""}import { createApp, type Repositories } from "../src/app";
import { createDataflowRoutes as createFailureRoutes } from "./fixtures/dataflow-failure";

beforeAll(() => {
${schema}
${auxiliarySchema}
${callAdapters.map((adapter) => `dataflowCallHandlers[${JSON.stringify(adapter)}] = () => ({ ok: true });`).join("\n")}
});

const resetTables = () => {
${cleanup}
};
beforeEach(resetTables);
afterEach(resetTables);

const testRoles: Record<string, QiyRole> = ${JSON.stringify(Object.fromEntries(dataflows.map((flow) => [flow.name, flow.roles?.[0] ?? roles.admin])))};
const app = new Elysia().use(createDataflowRoutes(async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: testRoles[new URL(request.url).pathname.split("/").at(-1)!] ?? QIY_ADMIN_ROLE${permissionPrincipal} })));
const graphqlApp = await createApp({} as Repositories, async (request) => { const role = request.headers.get("x-test-role"); return { id: "00000000-0000-4000-8000-000000000010", name: "GraphQL Dataflow Test", role: isQiyRole(role) ? role : QIY_ADMIN_ROLE${permissionPrincipal} }; }, false, undefined, true);

describe("generated dataflow routes", () => {
${tests}
});
`;
}

export function sqliteTestIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function scenarioPrincipal(scenario: QiyTestScenario, flow: DataflowIR, adminRole: string, permissionPrincipal = ""): string {
  if (scenario.identity?.kind === "anonymous") return "null";
  const identity = scenario.identity;
  const principal = identity ? {
    id: resolveQiyTestValue(scenario, identity.id), name: "Qiy Scenario", role: identity.role,
    claims: Object.fromEntries(Object.entries(identity.claims).map(([claim, value]) => [claim, resolveQiyTestValue(scenario, value)])),
  } : { id: "00000000-0000-4000-8000-000000000010", name: "Qiy Scenario", role: flow.roles?.[0] ?? adminRole };
  return identity ? JSON.stringify(principal) : JSON.stringify(principal).slice(0, -1) + `${permissionPrincipal} }`;
}

export function scenarioPermissionPrincipal(permissions?: QiyPermissionModel): string {
  return permissions && !isPermissionModelEmpty(permissions)
    ? `, permissions: ${JSON.stringify(declaredPermissionValues(permissions))}, groups: ${JSON.stringify(permissions.groups.map((group) => group.name))}`
    : "";
}

export function renderQiyScenarioTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, roles: RoleContext, suite?: QiyTestSuite, permissions?: QiyPermissionModel, deliveryTargets: Map<string, string[]> = new Map()): string | undefined {
  if (!suite) return undefined;
  if (database.dialect === "postgresql" || database.dialect === "mysql") return renderServerQiyScenarioTest(database, dataflows, roles, suite, permissions);
  if (database.dialect !== "sqlite") throw new Error("Declarative app.test.qiy scenarios require sqlite, postgresql or mysql");
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const selectedFlows = suite.scenarios.map((scenario) => dataflows.find((flow) => flow.name === scenario.dataflow)!);
  const entityNames = new Set<string>();
  for (const scenario of suite.scenarios) for (const fixture of scenario.given) entityNames.add(fixture.entity);
  for (const flow of selectedFlows) {
    for (const context of flow.context) entityNames.add(context.entity);
    for (const action of flow.steps.flatMap((step) => step.actions)) if (action.kind === "create") entityNames.add(action.entity);
  }
  const usedEntities = [...entityNames].map((name) => entities.get(name)!);
  const schema = usedEntities.map((entity) => {
    const columns = entity.fields.filter((field) => field.computed === undefined).map((field) => `${sqliteTestIdentifier(field.columnName ?? field.name)} ${sqliteColumnType(field)}${sqliteTestDefault(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
    return `client.exec(${JSON.stringify(`CREATE TABLE IF NOT EXISTS ${sqliteTestIdentifier(entity.tableName)} (${columns})`)});`;
  }).join("\n");
  const usesAudit = selectedFlows.some((flow) => flow.audit !== undefined);
  const usesIdempotency = selectedFlows.some((flow) => flow.idempotency?.required);
  const usesOutbox = selectedFlows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) || suite.scenarios.some((scenario) => scenario.expectedOutbox?.length);
  const usesDeliveryRows = selectedFlows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit" && deliveryTargets.has(action.event))));
  const callAdapters = dataflowCallAdapters(selectedFlows);
  const auxiliary = [
    ...(usesAudit ? [`client.exec("CREATE TABLE IF NOT EXISTS audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null)");`] : []),
    ...(usesIdempotency ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_idempotency (id text primary key, actorId text not null, flow text not null, requestKeyHash text not null, requestHash text not null, response text not null, UNIQUE(actorId, flow, requestKeyHash))");`] : []),
    ...(usesOutbox ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_outbox (id text primary key, actorId text, event text not null, payload text not null, createdAt integer not null)");`] : []),
    ...(usesDeliveryRows ? [`client.exec(${JSON.stringify(sqliteDeliveryDdl)});`] : []),
  ].join("\n");
  const cleanup = [
    ...[...usedEntities].reverse().map((entity) => `client.exec(${JSON.stringify(`DELETE FROM ${sqliteTestIdentifier(entity.tableName)}`)});`),
    ...(usesAudit ? ["client.exec('DELETE FROM audit_events');"] : []),
    ...(usesIdempotency ? ["client.exec('DELETE FROM dataflow_idempotency');"] : []),
    ...(usesOutbox ? ["client.exec('DELETE FROM dataflow_outbox');"] : []),
    ...(usesDeliveryRows ? ["client.exec('DELETE FROM qiy_deliveries');"] : []),
  ].join("\n");
  const tests = suite.scenarios.map((scenario) => {
    const flow = dataflows.find((item) => item.name === scenario.dataflow)!;
    const seed = scenario.given.map((fixture) => {
      const entity = entities.get(fixture.entity)!;
      const fields = Object.keys(fixture.values);
      const columns = fields.map((name) => sqliteTestIdentifier(entity.fields.find((field) => field.name === name)!.columnName ?? name));
      const placeholders = fields.map(() => "?");
      const values = fields.map((name) => fixture.values[name]);
      return `client.query(${JSON.stringify(`INSERT INTO ${sqliteTestIdentifier(entity.tableName)} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`)}).run(...${JSON.stringify(values)});`;
    }).join("\n    ");
    const input = Object.fromEntries(Object.entries(scenario.input).map(([name, configured]) => [name, resolveQiyTestValue(scenario, configured)]));
    const headers = `{ "Content-Type": "application/json"${flow.idempotency?.required ? `, "Idempotency-Key": ${JSON.stringify(`qiy-scenario-${scenario.name}`)}` : ""} }`;
    const payloadExpectation = scenario.expectedErrorKey === undefined ? "" : `\n    expect(payload).toMatchObject({ errorKey: ${JSON.stringify(scenario.expectedErrorKey)} });`;
    const fieldExpectations = scenario.expectedFields.map((expectation) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = entities.get(fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      const primaryValue = fixture.values[primary.name]!;
      const field = entity.fields.find((item) => item.name === expectation.field)!;
      const expected = resolveQiyTestValue(scenario, expectation.value);
      const query = `SELECT ${sqliteTestIdentifier(field.columnName ?? field.name)} AS value FROM ${sqliteTestIdentifier(entity.tableName)} WHERE ${sqliteTestIdentifier(primary.columnName ?? primary.name)} = ?`;
      return `expect(client.query<{ value: unknown }, [string | number]>(${JSON.stringify(query)}).get(${JSON.stringify(primaryValue)})?.value).toBe(${JSON.stringify(expected)});`;
    }).join("\n    ");
    const existenceExpectations = (scenario.expectedExists ?? []).map((expectation) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = entities.get(fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      const query = `SELECT 1 AS value FROM ${sqliteTestIdentifier(entity.tableName)} WHERE ${sqliteTestIdentifier(primary.columnName ?? primary.name)} = ?`;
      return `expect(Boolean(client.query<{ value: number }, [string | number]>(${JSON.stringify(query)}).get(${JSON.stringify(fixture.values[primary.name])}))).toBe(${expectation.exists});`;
    }).join("\n    ");
    const outboxExpectations = (scenario.expectedOutbox ?? []).map((expectation) => `expect(client.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM dataflow_outbox WHERE event = ?").get(${JSON.stringify(expectation.event)})?.total).toBe(${expectation.count});`).join("\n    ");
    return `  test(${JSON.stringify(scenario.name)}, async () => {
    ${seed}
    const app = new Elysia().use(createDataflowRoutes(async () => (${scenarioPrincipal(scenario, flow, roles.admin, scenarioPermissionPrincipal(permissions))})));
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${scenario.dataflow}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(${scenario.expectedStatus});
    const payload = await response.json();${payloadExpectation}
    ${fieldExpectations || "expect(payload).toBeDefined();"}
    ${existenceExpectations}
    ${outboxExpectations}
  });`;
  }).join("\n\n");
  return `import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createDataflowRoutes } from "../src/dataflows";
${callAdapters.length ? 'import { dataflowCallHandlers } from "../src/extensions/dataflow-calls";\n' : ""}
beforeAll(() => {
${schema}
${auxiliary}
${callAdapters.map((adapter) => `dataflowCallHandlers[${JSON.stringify(adapter)}] = () => ({ ok: true });`).join("\n")}
});

afterEach(() => {
${cleanup}
});

describe("declarative qiy scenarios", () => {
${tests}
});
`;
}

export function renderServerQiyScenarioTest(database: DatabaseIR, dataflows: DataflowIR[], roles: RoleContext, suite: QiyTestSuite, permissions?: QiyPermissionModel): string {
  const orderedEntities: EntityIR[] = [];
  const visiting = new Set<string>();
  const visit = (entity: EntityIR) => {
    if (orderedEntities.includes(entity)) return;
    if (visiting.has(entity.name)) throw new Error("Declarative database scenarios cannot automatically clean cyclic foreign keys");
    visiting.add(entity.name);
    for (const relation of database.relations ?? []) {
      if (relation.fromEntity === entity.name) visit(database.entities.find((item) => item.name === relation.toEntity)!);
    }
    visiting.delete(entity.name);
    orderedEntities.push(entity);
  };
  database.entities.forEach(visit);
  const selectedFlows = suite.scenarios.map((scenario) => dataflows.find((flow) => flow.name === scenario.dataflow)!);
  const callAdapters = dataflowCallAdapters(selectedFlows);
  const valueCode = (field: FieldIR, value: string | number | boolean) => field.type === "DateTime"
    ? `new Date(${JSON.stringify(value)})`
    : field.type === "Decimal" || field.type === "Money" ? JSON.stringify(String(value)) : JSON.stringify(value);
  const scenarios = suite.scenarios.map((scenario) => {
    const flow = selectedFlows.find((item) => item.name === scenario.dataflow)!;
    const seed = [...scenario.given].sort((first, second) => orderedEntities.findIndex((entity) => entity.name === first.entity) - orderedEntities.findIndex((entity) => entity.name === second.entity)).map((fixture) => {
      const entity = database.entities.find((item) => item.name === fixture.entity)!;
      const values = Object.entries(fixture.values).map(([name, value]) => `${JSON.stringify(name)}: ${valueCode(entity.fields.find((field) => field.name === name)!, value)}`);
      return `await db.insert(schema.${entity.name}).values({ ${values.join(", ")} });`;
    }).join("\n    ");
    const input = Object.fromEntries(Object.entries(scenario.input).map(([name, value]) => [name, resolveQiyTestValue(scenario, value)]));
    const expected = scenario.expectedFields.map((expectation, index) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = database.entities.find((item) => item.name === fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      const field = entity.fields.find((item) => item.name === expectation.field)!;
      return `const rows${index} = await db.select({ value: schema.${entity.name}.${field.name} }).from(schema.${entity.name}).where(eq(schema.${entity.name}.${primary.name}, ${valueCode(primary, fixture.values[primary.name]!)}));\n    expect(rows${index}[0]?.value).toEqual(${valueCode(field, resolveQiyTestValue(scenario, expectation.value))});`;
    }).join("\n    ");
    const existenceExpectations = (scenario.expectedExists ?? []).map((expectation, index) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = database.entities.find((item) => item.name === fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      return `const exists${index} = await db.select({ id: schema.${entity.name}.${primary.name} }).from(schema.${entity.name}).where(eq(schema.${entity.name}.${primary.name}, ${valueCode(primary, fixture.values[primary.name]!)})).limit(1);\n    expect(exists${index}.length > 0).toBe(${expectation.exists});`;
    }).join("\n    ");
    const outboxExpectations = (scenario.expectedOutbox ?? []).map((expectation, index) => `const outbox${index} = await db.select({ total: count() }).from(schema.dataflowOutbox).where(eq(schema.dataflowOutbox.event, ${JSON.stringify(expectation.event)}));\n    expect(Number(outbox${index}[0]?.total)).toBe(${expectation.count});`).join("\n    ");
    return `  test(${JSON.stringify(scenario.name)}, async () => {
    ${seed}
    const app = new Elysia().use(createDataflowRoutes(async () => (${scenarioPrincipal(scenario, flow, roles.admin, scenarioPermissionPrincipal(permissions))})));
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${scenario.dataflow}`)}, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(${scenario.expectedStatus});
    const payload = await response.json();
    ${scenario.expectedErrorKey === undefined ? "expect(payload).toBeDefined();" : `expect(payload).toMatchObject({ errorKey: ${JSON.stringify(scenario.expectedErrorKey)} });`}
    ${expected}
    ${existenceExpectations}
    ${outboxExpectations}
  });`;
  }).join("\n\n");
  const cleanup = orderedEntities.slice().reverse().map((entity) => `  await db.delete(schema.${entity.name});`).join("\n");
  const auxiliary = [
    ...(dataflows.some((flow) => flow.audit) ? ["auditEvents"] : []),
    ...(dataflows.some((flow) => flow.idempotency?.required) ? ["dataflowIdempotency"] : []),
    ...(dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? ["dataflowOutbox"] : []),
  ].map((name) => `  await db.delete(schema.${name});`).join("\n");
  return `import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq${suite.scenarios.some((scenario) => scenario.expectedOutbox?.length) ? ", count" : ""} } from "drizzle-orm";
import { Elysia } from "elysia";

const testUrl = Bun.env.QIY_TEST_DATABASE_URL;
if (!testUrl || testUrl !== Bun.env.DATABASE_URL || !/^\\/qiy_test_[a-zA-Z0-9_]+$/.test(new URL(testUrl).pathname)) {
  throw new Error("Declarative scenarios require DATABASE_URL = QIY_TEST_DATABASE_URL pointing to a dedicated qiy_test_* database; migrate it first");
}
const { db } = await import("../src/db");
const schema = await import("../src/schema");
const { createDataflowRoutes } = await import("../src/dataflows");
${callAdapters.length ? 'const { dataflowCallHandlers } = await import("../src/extensions/dataflow-calls");' : ""}
async function cleanup() {
${auxiliary}
${cleanup}
}
beforeEach(async () => {
  await cleanup();
${callAdapters.map((adapter) => `  dataflowCallHandlers[${JSON.stringify(adapter)}] = () => ({ ok: true });`).join("\n")}
});
afterEach(cleanup);
describe("declarative qiy scenarios", () => {
${scenarios}
});
`;
}
