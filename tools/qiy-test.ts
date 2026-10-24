import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { FieldIR } from "./database-ir";
import type { QiyProject } from "./qiy-project";

export type QiyTestScalar = string | number | boolean;

export type QiyTestValue =
  | { kind: "literal"; value: QiyTestScalar }
  | { kind: "reference"; alias: string; field: string };

export interface QiyTestScenario {
  name: string;
  identity?: { kind: "anonymous" } | { kind: "principal"; id: QiyTestValue; role: "admin" | "operator" | "viewer"; claims: Record<string, QiyTestValue> };
  given: Array<{ alias: string; entity: string; values: Record<string, QiyTestScalar> }>;
  dataflow: string;
  input: Record<string, QiyTestValue>;
  expectedStatus: number;
  expectedErrorKey?: string;
  expectedFields: Array<{ alias: string; field: string; value: QiyTestValue }>;
  expectedExists?: Array<{ alias: string; exists: boolean }>;
  expectedOutbox?: Array<{ event: string; count: number }>;
}

export interface QiyTestSuite {
  application: string;
  scenarios: QiyTestScenario[];
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fieldType(field: FieldIR): string {
  return field.enumName ?? field.type;
}

function scalarMatches(project: QiyProject, type: string, value: QiyTestScalar): boolean {
  const enumeration = project.database.enums?.find((item) => item.name === type);
  if (enumeration) return typeof value === "string" && enumeration.values.some((item) => item.name === value);
  if (type === "UUID") return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (type === "Text" || type === "File") return typeof value === "string";
  if (type === "Integer") return typeof value === "number" && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (type === "Decimal" || type === "Money") return typeof value === "number" && Number.isFinite(value);
  if (type === "DateTime") return typeof value === "number" && Number.isSafeInteger(value);
  if (type === "Date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (type === "Time") return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
  if (type === "Boolean") return typeof value === "boolean";
  return false;
}

export function resolveQiyTestValue(scenario: QiyTestScenario, value: QiyTestValue): QiyTestScalar {
  if (value.kind === "literal") return value.value;
  const fixture = scenario.given.find((item) => item.alias === value.alias);
  if (!fixture || !Object.hasOwn(fixture.values, value.field)) throw new Error(`Scenario ${scenario.name}: unresolved reference ${value.alias}.${value.field}`);
  return fixture.values[value.field]!;
}

export function validateQiyTestSuite(suite: QiyTestSuite, project: QiyProject): void {
  if (normalizeName(suite.application) !== normalizeName(project.name)) {
    throw new Error(`Qiy test application ${suite.application} does not match ${project.name}`);
  }
  if (!suite.scenarios.length) throw new Error("Qiy test suite requires at least one scenario");
  const scenarioNames = new Set<string>();
  for (const scenario of suite.scenarios) {
    if (scenarioNames.has(scenario.name)) throw new Error(`Duplicate Qiy test scenario ${scenario.name}`);
    scenarioNames.add(scenario.name);
    const aliases = new Set<string>();
    for (const fixture of scenario.given) {
      if (aliases.has(fixture.alias)) throw new Error(`Scenario ${scenario.name}: duplicate fixture alias ${fixture.alias}`);
      aliases.add(fixture.alias);
      const entity = project.database.entities.find((item) => item.name === fixture.entity);
      if (!entity) throw new Error(`Scenario ${scenario.name}: unknown fixture entity ${fixture.entity}`);
      for (const [name, value] of Object.entries(fixture.values)) {
        const field = entity.fields.find((item) => item.name === name);
        if (!field) throw new Error(`Scenario ${scenario.name}: unknown fixture field ${fixture.entity}.${name}`);
        if (!scalarMatches(project, fieldType(field), value)) throw new Error(`Scenario ${scenario.name}: invalid value for ${fixture.entity}.${name}`);
      }
      for (const field of entity.fields) {
        if (!field.nullable && !Object.hasOwn(fixture.values, field.name)) throw new Error(`Scenario ${scenario.name}: fixture ${fixture.alias} requires ${fixture.entity}.${field.name}`);
      }
    }
    const flow = project.dataflows?.find((item) => item.name === scenario.dataflow);
    if (!flow) throw new Error(`Scenario ${scenario.name}: unknown dataflow ${scenario.dataflow}`);
    if (scenario.identity?.kind === "principal") {
      const identity = scenario.identity;
      const id = resolveQiyTestValue(scenario, identity.id);
      if (typeof id !== "string" || !id.trim()) throw new Error(`Scenario ${scenario.name}: identity id must be nonempty text`);
      if (!["admin", "operator", "viewer"].includes(identity.role)) throw new Error(`Scenario ${scenario.name}: unknown identity role`);
      for (const [claim, value] of Object.entries(identity.claims)) {
        if (!claim.trim() || ["__proto__", "prototype", "constructor"].includes(claim)) throw new Error(`Scenario ${scenario.name}: invalid identity claim ${claim}`);
        const configured = resolveQiyTestValue(scenario, value);
        if (typeof configured === "number" && !Number.isFinite(configured)) throw new Error(`Scenario ${scenario.name}: invalid identity claim value`);
        for (const scope of project.scopes ?? []) {
          if (scope.claim !== claim) continue;
          const entity = project.database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)!;
          const field = entity.fields.find((item) => item.name === scope.field)!;
          if (!scalarMatches(project, fieldType(field), configured)) throw new Error(`Scenario ${scenario.name}: invalid value for scope claim ${claim}`);
        }
      }
    }
    for (const name of Object.keys(scenario.input)) {
      if (!flow.input.some((field) => field.name === name)) throw new Error(`Scenario ${scenario.name}: unknown input ${scenario.dataflow}.${name}`);
    }
    for (const input of flow.input) {
      const configured = scenario.input[input.name];
      if (!configured) {
        if (input.required) throw new Error(`Scenario ${scenario.name}: missing required input ${scenario.dataflow}.${input.name}`);
        continue;
      }
      const resolved = resolveQiyTestValue(scenario, configured);
      if (!scalarMatches(project, input.type, resolved)) throw new Error(`Scenario ${scenario.name}: invalid input ${scenario.dataflow}.${input.name}`);
    }
    if (!Number.isInteger(scenario.expectedStatus) || scenario.expectedStatus < 100 || scenario.expectedStatus > 599) {
      throw new Error(`Scenario ${scenario.name}: expected status must be an HTTP status`);
    }
    if (scenario.expectedErrorKey !== undefined && !scenario.expectedErrorKey.trim()) throw new Error(`Scenario ${scenario.name}: expected errorKey cannot be empty`);
    const expectedFieldNames = new Set<string>();
    const existenceAliases = new Set<string>();
    for (const expectation of scenario.expectedExists ?? []) {
      if (!aliases.has(expectation.alias)) throw new Error(`Scenario ${scenario.name}: unknown expected fixture ${expectation.alias}`);
      if (existenceAliases.has(expectation.alias)) throw new Error(`Scenario ${scenario.name}: duplicate existence expectation ${expectation.alias}`);
      existenceAliases.add(expectation.alias);
      if (typeof expectation.exists !== "boolean") throw new Error(`Scenario ${scenario.name}: existence expectation must be boolean`);
      if (!expectation.exists && scenario.expectedFields.some((field) => field.alias === expectation.alias)) throw new Error(`Scenario ${scenario.name}: deleted fixture ${expectation.alias} cannot have field expectations`);
    }
    const declaredEvents = new Set((project.dataflows ?? []).flatMap((item) => item.steps.flatMap((step) => step.actions.flatMap((action) => action.kind === "emit" ? [action.event] : []))));
    const expectedEvents = new Set<string>();
    for (const expectation of scenario.expectedOutbox ?? []) {
      if (!declaredEvents.has(expectation.event)) throw new Error(`Scenario ${scenario.name}: unknown outbox event ${expectation.event}`);
      if (expectedEvents.has(expectation.event)) throw new Error(`Scenario ${scenario.name}: duplicate outbox expectation ${expectation.event}`);
      expectedEvents.add(expectation.event);
      if (!Number.isSafeInteger(expectation.count) || expectation.count < 0) throw new Error(`Scenario ${scenario.name}: outbox count must be a nonnegative integer`);
    }
    for (const expectation of scenario.expectedFields) {
      const expectedName = `${expectation.alias}.${expectation.field}`;
      if (expectedFieldNames.has(expectedName)) throw new Error(`Scenario ${scenario.name}: duplicate expectation ${expectedName}`);
      expectedFieldNames.add(expectedName);
      const fixture = scenario.given.find((item) => item.alias === expectation.alias);
      if (!fixture) throw new Error(`Scenario ${scenario.name}: unknown expected fixture ${expectation.alias}`);
      const entity = project.database.entities.find((item) => item.name === fixture.entity)!;
      const field = entity.fields.find((item) => item.name === expectation.field);
      if (!field) throw new Error(`Scenario ${scenario.name}: unknown expected field ${fixture.entity}.${expectation.field}`);
      const resolved = resolveQiyTestValue(scenario, expectation.value);
      if (!scalarMatches(project, fieldType(field), resolved)) throw new Error(`Scenario ${scenario.name}: invalid expectation for ${fixture.entity}.${expectation.field}`);
    }
  }
}

export function parseQiyTestSuite(input: string): QiyTestSuite {
  const pattern = /\s+|\/\/[^\r\n]*|#[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|==|[a-zA-Z_][a-zA-Z_0-9-]*|-?\d+(?:\.\d+)?|[{}();.=]/g;
  const tokens: string[] = [];
  let end = 0;
  for (const match of input.matchAll(pattern)) {
    if (match.index !== end) throw new Error(`Unexpected Qiy test syntax at offset ${end}`);
    if (!/^\s|^\/\/|^#/.test(match[0])) tokens.push(match[0]);
    end += match[0].length;
  }
  if (end !== input.length) throw new Error(`Unexpected Qiy test syntax at offset ${end}`);
  tokens.push("<end>");
  let position = 0;
  const peek = () => tokens[position]!;
  const take = () => tokens[position++]!;
  const expect = (token: string) => { if (take() !== token) throw new Error(`Expected ${token} near Qiy test token ${position}`); };
  const identifier = () => {
    const token = take();
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(token)) throw new Error(`Expected identifier near Qiy test token ${position}`);
    return token;
  };
  const scalar = (): QiyTestScalar => {
    const token = take();
    if (token.startsWith('"')) return JSON.parse(token) as string;
    if (token.startsWith("'")) return token.slice(1, -1).replace(/\\([\\'])/g, "$1");
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    if (token === "true") return true;
    if (token === "false") return false;
    throw new Error(`Expected scalar near Qiy test token ${position}`);
  };
  const testValue = (): QiyTestValue => {
    const token = peek();
    if (token.startsWith('"') || token.startsWith("'") || /^-?\d+(?:\.\d+)?$/.test(token) || token === "true" || token === "false") return { kind: "literal", value: scalar() };
    const alias = identifier();
    expect(".");
    return { kind: "reference", alias, field: identifier() };
  };

  expect("qiy"); expect("test"); expect("v0"); expect(";");
  expect("application"); const application = identifier(); expect(";");
  const scenarios: QiyTestScenario[] = [];
  while (peek() !== "<end>") {
    expect("scenario");
    const name = identifier();
    expect("{");
    const given: QiyTestScenario["given"] = [];
    while (peek() === "given") {
      expect("given");
      const alias = identifier();
      expect("="); expect("entity");
      const entity = identifier();
      expect("{");
      const values: Record<string, QiyTestScalar> = {};
      while (peek() !== "}") {
        const field = identifier();
        if (Object.hasOwn(values, field)) throw new Error(`Scenario ${name}: duplicate fixture field ${alias}.${field}`);
        expect("="); values[field] = scalar(); expect(";");
      }
      expect("}");
      given.push({ alias, entity, values });
    }
    let identity: QiyTestScenario["identity"];
    if (peek() === "identity") {
      expect("identity");
      if (peek() === "anonymous") {
        expect("anonymous"); expect(";");
        identity = { kind: "anonymous" };
      } else {
        expect("{");
        let id: QiyTestValue | undefined;
        let role: "admin" | "operator" | "viewer" | undefined;
        let claims: Record<string, QiyTestValue> | undefined;
        while (peek() !== "}") {
          const setting = identifier();
          if (setting === "id") {
            if (id) throw new Error(`Scenario ${name}: duplicate identity id`);
            expect("="); id = testValue(); expect(";");
          } else if (setting === "role") {
            if (role) throw new Error(`Scenario ${name}: duplicate identity role`);
            expect("=");
            const configured = scalar();
            if (configured !== "admin" && configured !== "operator" && configured !== "viewer") throw new Error(`Scenario ${name}: unknown identity role`);
            role = configured; expect(";");
          } else if (setting === "claims") {
            if (claims) throw new Error(`Scenario ${name}: duplicate identity claims`);
            claims = Object.create(null) as Record<string, QiyTestValue>;
            expect("{");
            while (peek() !== "}") {
              const claim = scalar();
              if (typeof claim !== "string" || !claim.trim() || ["__proto__", "prototype", "constructor"].includes(claim)) throw new Error(`Scenario ${name}: invalid identity claim`);
              if (Object.hasOwn(claims, claim)) throw new Error(`Scenario ${name}: duplicate identity claim ${claim}`);
              expect("="); claims[claim] = testValue(); expect(";");
            }
            expect("}");
          } else throw new Error(`Scenario ${name}: unknown identity setting ${setting}`);
        }
        expect("}");
        if (!id || !role) throw new Error(`Scenario ${name}: identity requires id and role`);
        identity = { kind: "principal", id, role, claims: claims ?? {} };
      }
    }
    expect("when"); expect("dataflow");
    const dataflow = identifier();
    expect("{");
    const scenarioInput: Record<string, QiyTestValue> = {};
    while (peek() !== "}") {
      const field = identifier();
      if (Object.hasOwn(scenarioInput, field)) throw new Error(`Scenario ${name}: duplicate input ${field}`);
      expect("="); scenarioInput[field] = testValue(); expect(";");
    }
    expect("}");
    let expectedStatus: number | undefined;
    let expectedErrorKey: string | undefined;
    const expectedFields: QiyTestScenario["expectedFields"] = [];
    const expectedExists: NonNullable<QiyTestScenario["expectedExists"]> = [];
    const expectedOutbox: NonNullable<QiyTestScenario["expectedOutbox"]> = [];
    while (peek() === "expect") {
      expect("expect");
      if (peek() === "status") {
        expect("status"); expect("==");
        const configured = scalar();
        if (typeof configured !== "number") throw new Error(`Scenario ${name}: expected status must be numeric`);
        if (expectedStatus !== undefined) throw new Error(`Scenario ${name}: duplicate status expectation`);
        expectedStatus = configured;
      } else if (peek() === "errorKey") {
        expect("errorKey"); expect("==");
        const configured = scalar();
        if (typeof configured !== "string") throw new Error(`Scenario ${name}: expected errorKey must be text`);
        if (expectedErrorKey !== undefined) throw new Error(`Scenario ${name}: duplicate errorKey expectation`);
        expectedErrorKey = configured;
      } else if (peek() === "exists") {
        expect("exists"); const alias = identifier(); expect("==");
        const configured = scalar();
        if (typeof configured !== "boolean") throw new Error(`Scenario ${name}: existence expectation must be boolean`);
        expectedExists.push({ alias, exists: configured });
      } else if (peek() === "outbox") {
        expect("outbox"); const event = scalar(); expect("count"); expect("==");
        const count = scalar();
        if (typeof event !== "string" || typeof count !== "number") throw new Error(`Scenario ${name}: outbox requires a text event and numeric count`);
        expectedOutbox.push({ event, count });
      } else {
        const alias = identifier(); expect("."); const field = identifier(); expect("==");
        expectedFields.push({ alias, field, value: testValue() });
      }
      expect(";");
    }
    if (expectedStatus === undefined) throw new Error(`Scenario ${name}: expect status is required`);
    expect("}");
    scenarios.push({ name, given, ...(identity && { identity }), dataflow, input: scenarioInput, expectedStatus, ...(expectedErrorKey !== undefined && { expectedErrorKey }), expectedFields, ...(expectedExists.length && { expectedExists }), ...(expectedOutbox.length && { expectedOutbox }) });
  }
  return { application, scenarios };
}

export function loadQiyTestSuite(source: string, project: QiyProject): QiyTestSuite | undefined {
  const entry = resolve(source);
  const extension = extname(entry);
  const testPath = join(dirname(entry), `${basename(entry, extension)}.test.qiy`);
  if (!existsSync(testPath)) return undefined;
  const suite = parseQiyTestSuite(readFileSync(testPath, "utf8"));
  validateQiyTestSuite(suite, project);
  return suite;
}
