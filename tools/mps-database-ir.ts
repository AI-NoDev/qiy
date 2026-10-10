import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { DatabaseIR, EntityIR, FieldIR, IndexIR, RelationIR } from "./database-ir";

type XmlElement = Record<string, unknown>;
type XmlNode = XmlElement & { "@_concept": string; "@_role"?: string; "@_id": string };

interface ConceptDefinition {
  name: string;
  properties: Map<string, string>;
  children: Map<string, string>;
}

interface DecodedNode {
  concept: string;
  id: string;
  properties: Map<string, string>;
  children: Map<string, DecodedNode[]>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  isArray: (tag) => ["language", "concept", "property", "child", "node"].includes(tag),
});

function elements(value: unknown): XmlElement[] {
  return value === undefined ? [] : Array.isArray(value) ? value as XmlElement[] : [value as XmlElement];
}

function attribute(element: XmlElement, name: string): string {
  const value = element[`@_${name}`];
  if (typeof value !== "string") throw new Error(`MPS XML: missing ${name} attribute`);
  return value;
}

function parseXml(xml: string): XmlElement {
  const result = XMLValidator.validate(xml);
  if (result !== true) throw new Error(`Invalid MPS XML: ${result.err.msg}`);
  const model = (xmlParser.parse(xml) as XmlElement).model;
  if (!model || typeof model !== "object") throw new Error("MPS XML: missing model element");
  return model as XmlElement;
}

function structureDefinitions(structureXml: string): Map<string, ConceptDefinition> {
  const model = parseXml(structureXml);
  const definitions = new Map<string, ConceptDefinition>();
  for (const concept of elements(model.node)) {
    const properties = new Map(elements(concept.property).map((property) => [attribute(property, "role"), attribute(property, "value")]));
    const id = properties.get("EcuMT");
    const name = properties.get("TrG5h");
    if (!id || !name) continue;
    const fields = new Map<string, string>();
    const children = new Map<string, string>();
    for (const declaration of elements(concept.node)) {
      const declared = new Map(elements(declaration.property).map((property) => [attribute(property, "role"), attribute(property, "value")]));
      if (declaration["@_concept"] === "1TJgyi") {
        fields.set(declared.get("IQ2nx") ?? "", declared.get("TrG5h") ?? "");
      } else if (declaration["@_concept"] === "1TJgyj") {
        children.set(declared.get("IQ2ns") ?? "", declared.get("20kJfa") ?? "");
      }
    }
    definitions.set(id, { name, properties: fields, children });
  }
  if (!definitions.has("720000000000000001")) throw new Error("MPS XML: missing Qiy structure definitions");
  return definitions;
}

function registryDefinitions(model: XmlElement, structure: Map<string, ConceptDefinition>): Map<string, ConceptDefinition> {
  const definitions = new Map<string, ConceptDefinition>();
  for (const language of elements((model.registry as XmlElement | undefined)?.language)) {
    for (const concept of elements(language.concept)) {
      const id = attribute(concept, "id");
      const name = attribute(concept, "name");
      const expected = structure.get(id);
      if (name.startsWith("qiy.structure.") && (!expected || name !== `qiy.structure.${expected.name}`)) {
        throw new Error(`MPS XML: concept ${name} does not match Qiy structure`);
      }
      if (name === "jetbrains.mps.lang.core.structure.INamedConcept" && id !== "1169194658468") {
        throw new Error("MPS XML: invalid INamedConcept ID");
      }
      const properties = new Map<string, string>();
      const children = new Map<string, string>();
      for (const property of elements(concept.property)) {
        const propertyId = attribute(property, "id");
        const propertyName = attribute(property, "name");
        if (expected && expected.properties.get(propertyId) !== propertyName) {
          throw new Error(`MPS XML: property ${name}.${propertyName} does not match Qiy structure`);
        }
        if (name === "jetbrains.mps.lang.core.structure.INamedConcept" && (propertyId !== "1169194664001" || propertyName !== "name")) {
          throw new Error("MPS XML: invalid INamedConcept.name property");
        }
        const propertyIndex = attribute(property, "index");
        if (properties.has(propertyIndex) || [...properties.values()].includes(propertyName)) {
          throw new Error(`MPS XML: duplicate property registry entry ${name}.${propertyName}`);
        }
        properties.set(propertyIndex, propertyName);
      }
      for (const child of elements(concept.child)) {
        const childId = attribute(child, "id");
        const childName = attribute(child, "name");
        if (expected && expected.children.get(childId) !== childName) {
          throw new Error(`MPS XML: child ${name}.${childName} does not match Qiy structure`);
        }
        const childIndex = attribute(child, "index");
        if (children.has(childIndex) || [...children.values()].includes(childName)) {
          throw new Error(`MPS XML: duplicate child registry entry ${name}.${childName}`);
        }
        children.set(childIndex, childName);
      }
      const index = attribute(concept, "index");
      if (definitions.has(index)) throw new Error(`MPS XML: duplicate concept index ${index}`);
      definitions.set(index, { name, properties, children });
    }
  }
  return definitions;
}

function decode(xmlNode: XmlNode, definitions: Map<string, ConceptDefinition>, nodeIds: Set<string>, inheritedName?: string): DecodedNode {
  const id = attribute(xmlNode, "id");
  if (!id) throw new Error("MPS XML: empty node ID");
  if (nodeIds.has(id)) throw new Error(`MPS XML: duplicate node ID ${id}`);
  nodeIds.add(id);
  if (elements(xmlNode.ref).length) throw new Error(`MPS ${id}: unsupported node references`);
  const concept = definitions.get(attribute(xmlNode, "concept"));
  if (!concept || !concept.name.startsWith("qiy.structure.")) {
    throw new Error(`MPS XML: unknown Qiy concept ${xmlNode["@_concept"]}`);
  }
  const properties = new Map<string, string>();
  const children = new Map<string, DecodedNode[]>();
  for (const property of elements(xmlNode.property)) {
    const role = attribute(property, "role");
    const name = concept.properties.get(role) ?? (role === inheritedName ? "name" : undefined);
    if (!name) throw new Error(`MPS XML: unknown property role ${role} on ${concept.name}`);
    if (properties.has(name)) throw new Error(`MPS XML: duplicate property ${concept.name}.${name}`);
    properties.set(name, attribute(property, "value"));
  }
  for (const child of elements(xmlNode.node)) {
    const role = attribute(child, "role");
    const name = concept.children.get(role);
    if (!name) throw new Error(`MPS XML: unknown child role ${role} on ${concept.name}`);
    const values = children.get(name) ?? [];
    values.push(decode(child as XmlNode, definitions, nodeIds, inheritedName));
    children.set(name, values);
  }
  return { concept: concept.name, id, properties, children };
}

function only(node: DecodedNode, concept: string, properties: string[], children: string[] = []): void {
  if (node.concept !== `qiy.structure.${concept}`) throw new Error(`MPS ${node.id}: expected ${concept}, got ${node.concept}`);
  for (const property of node.properties.keys()) {
    if (!properties.includes(property)) throw new Error(`MPS ${node.id}: unsupported ${concept}.${property}`);
  }
  for (const child of node.children.keys()) {
    if (!children.includes(child)) throw new Error(`MPS ${node.id}: unsupported ${concept}.${child}`);
  }
}

function required(node: DecodedNode, property: string): string {
  const value = node.properties.get(property);
  if (!value) throw new Error(`MPS ${node.id}: missing ${node.concept}.${property}`);
  return value;
}

function optionalBoolean(node: DecodedNode, property: string): boolean | undefined {
  const value = node.properties.get(property);
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false") throw new Error(`MPS ${node.id}: ${property} must be true or false`);
  return value === "true";
}

function optionalInteger(node: DecodedNode, property: string): number | undefined {
  const value = node.properties.get(property);
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`MPS ${node.id}: ${property} must be a safe integer`);
  }
  return Number(value);
}

function field(node: DecodedNode): FieldIR {
  only(node, "Field", ["name", "type", "columnName", "nullable", "primaryKey", "unique", "extension", "dimension", "precision", "scale", "visible", "listVisible", "formVisible", "showVisible", "sortable", "filterable", "label", "icon"]);
  return {
    name: required(node, "name"),
    type: required(node, "type") as FieldIR["type"],
    ...(node.properties.has("columnName") && { columnName: node.properties.get("columnName") }),
    ...(node.properties.has("extension") && { extension: node.properties.get("extension") }),
    ...(node.properties.has("nullable") && { nullable: optionalBoolean(node, "nullable") }),
    ...(node.properties.has("primaryKey") && { primaryKey: optionalBoolean(node, "primaryKey") }),
    ...(node.properties.has("unique") && { unique: optionalBoolean(node, "unique") }),
    ...(node.properties.has("dimension") && { dimension: optionalInteger(node, "dimension") }),
    ...(node.properties.has("precision") && { precision: optionalInteger(node, "precision") }),
    ...(node.properties.has("scale") && { scale: optionalInteger(node, "scale") }),
    ...(node.properties.has("visible") && { visible: optionalBoolean(node, "visible") }),
    ...(node.properties.has("listVisible") && { listVisible: optionalBoolean(node, "listVisible") }),
    ...(node.properties.has("formVisible") && { formVisible: optionalBoolean(node, "formVisible") }),
    ...(node.properties.has("showVisible") && { showVisible: optionalBoolean(node, "showVisible") }),
    ...(node.properties.has("sortable") && { sortable: optionalBoolean(node, "sortable") }),
    ...(node.properties.has("filterable") && { filterable: optionalBoolean(node, "filterable") }),
    ...(node.properties.has("label") && { label: node.properties.get("label") }),
    ...(node.properties.has("icon") && { icon: node.properties.get("icon") }),
  };
}

function index(node: DecodedNode): IndexIR {
  only(node, "Index", ["name", "method", "unique", "concurrently"], ["columns"]);
  return {
    name: required(node, "name"),
    method: required(node, "method") as IndexIR["method"],
    columns: (node.children.get("columns") ?? []).map((column) => {
      only(column, "IndexColumn", ["fieldName", "opclass", "name"]);
      return {
        fieldName: required(column, "fieldName"),
        ...(column.properties.has("opclass") && { opclass: column.properties.get("opclass") }),
      };
    }),
    ...(node.properties.has("unique") && { unique: optionalBoolean(node, "unique") }),
    ...(node.properties.has("concurrently") && { concurrently: optionalBoolean(node, "concurrently") }),
  };
}

function entity(node: DecodedNode): EntityIR {
  only(node, "Entity", ["name", "tableName", "schema"], ["fields", "indexes"]);
  const schema = node.properties.get("schema");
  if (schema && schema !== "public") throw new Error(`MPS ${node.id}: unsupported Entity.schema ${schema}`);
  return {
    name: required(node, "name"),
    tableName: required(node, "tableName"),
    fields: (node.children.get("fields") ?? []).map(field),
    indexes: (node.children.get("indexes") ?? []).map(index),
  };
}

function relation(node: DecodedNode): RelationIR {
  only(node, "Relation", ["name", "fromEntity", "fromField", "toEntity", "toField", "cardinality", "onDelete"]);
  const cardinality = required(node, "cardinality");
  if (cardinality !== "one" && cardinality !== "many") {
    throw new Error(`MPS ${node.id}: cardinality must be one or many`);
  }
  const onDelete = node.properties.get("onDelete");
  if (onDelete !== undefined && onDelete !== "restrict" && onDelete !== "cascade" && onDelete !== "setNull") {
    throw new Error(`MPS ${node.id}: onDelete must be restrict, cascade or setNull`);
  }
  return {
    name: required(node, "name"),
    fromEntity: required(node, "fromEntity"),
    fromField: required(node, "fromField"),
    toEntity: required(node, "toEntity"),
    toField: required(node, "toField"),
    cardinality,
    ...(onDelete && { onDelete }),
  };
}

export interface MpsProjectIR {
  name: string;
  database: DatabaseIR;
  workflows?: Array<"orderInventory">;
  apiClient?: "rest" | "graphql";
  elysiaPlugins?: { bearer?: boolean; serverTiming?: boolean; graphqlAdapter?: "native" | "yoga" | "apollo"; cron?: Array<{ name: string; pattern: string; task: "cleanupMissingAttachments" }>; jwt?: { name: string; secretEnv: string }; static?: { assets: string; prefix: string }; html?: boolean; drizzle?: boolean };
  storageProvider?: "local" | "s3";
  auth?: { provider: "oidc" | "oauth2" | "sso"; userEntity: string; subjectField: string; roleField: string };
  scopes?: Array<{ resource: string; field: string; claim: string }>;
  menuGroups?: Array<{ name: string; label: string; icon?: string; parent?: string; resources: string[] }>;
  dashboardMetrics?: Array<{ name: string; resource: string; label: string; icon?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend"; groupBy?: string; days?: number }>;
}

export function parseMpsProjectModel(modelXml: string, structureXml: string): MpsProjectIR {
  const model = parseXml(modelXml);
  const definitions = registryDefinitions(model, structureDefinitions(structureXml));
  const namedConcept = [...definitions.values()].find((entry) => entry.name === "jetbrains.mps.lang.core.structure.INamedConcept");
  const nameRole = namedConcept && [...namedConcept.properties].find(([, name]) => name === "name")?.[0];
  if (!nameRole) throw new Error("MPS XML: missing INamedConcept.name role");
  const nodeIds = new Set<string>();
  const roots = elements(model.node).map((root) => decode(root as XmlNode, definitions, nodeIds, nameRole));
  if (roots.length !== 1) throw new Error("MPS XML: expected one Application root per Database IR");
  const application = roots[0]!;
  only(application, "Application", ["name", "apiClient"], ["database", "entities", "relations", "elysia", "storage", "auth", "scopes", "menuGroups", "dashboardMetrics", "workflows", "enums"]);
  const name = required(application, "name");
  const apiClient = application.properties.get("apiClient");
  if (apiClient !== undefined && apiClient !== "rest" && apiClient !== "graphql") {
    throw new Error(`MPS ${application.id}: apiClient must be rest or graphql`);
  }
  const workflows = (application.children.get("workflows") ?? []).map((workflow) => {
    only(workflow, "WorkflowConfig", ["name"]);
    const workflowName = required(workflow, "name");
    if (workflowName !== "orderInventory") throw new Error(`MPS ${workflow.id}: unsupported workflow ${workflowName}`);
    return workflowName as "orderInventory";
  });
  if (new Set(workflows).size !== workflows.length) throw new Error("MPS Application: duplicate workflow configuration");
  const databases = application.children.get("database") ?? [];
  if (databases.length !== 1) throw new Error("MPS XML: expected exactly one DatabaseConfig");
  const elysiaNodes = application.children.get("elysia") ?? [];
  if (elysiaNodes.length > 1) throw new Error("MPS XML: expected at most one ElysiaConfig");
  const elysia = elysiaNodes[0];
  if (elysia) only(elysia, "ElysiaConfig", ["bearer", "serverTiming", "graphqlAdapter", "jwt", "static", "html", "drizzle"], ["cron"]);
  const graphqlAdapter = elysia?.properties.get("graphqlAdapter");
  if (graphqlAdapter !== undefined && graphqlAdapter !== "native" && graphqlAdapter !== "yoga" && graphqlAdapter !== "apollo") {
    throw new Error(`MPS ${elysia?.id}: GraphQL adapter must be native, yoga or apollo`);
  }
  const cronNodes = elysia?.children.get("cron") ?? [];
  if (cronNodes.length > 1) throw new Error("MPS XML: expected at most one CronConfig");
  const cron = cronNodes[0];
  if (cron) only(cron, "CronConfig", [], ["jobs"]);
  if (cron && !(cron.children.get("jobs")?.length)) throw new Error("MPS XML: CronConfig requires at least one job");
  const cronNames = new Set<string>();
  const jobs = (cron?.children.get("jobs") ?? []).map((job) => {
    only(job, "CronJob", ["name", "pattern", "task"]);
    const name = required(job, "name");
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || cronNames.has(name)) throw new Error(`MPS ${job.id}: invalid or duplicate Cron job name ${name}`);
    cronNames.add(name);
    const pattern = required(job, "pattern");
    if (!/^[a-zA-Z0-9*?,/!#-]+(?: [a-zA-Z0-9*?,/!#-]+){4,5}$/.test(pattern)) throw new Error(`MPS ${job.id}: invalid Cron pattern`);
    const task = required(job, "task");
    if (task !== "cleanupMissingAttachments") throw new Error(`MPS ${job.id}: unsupported Cron task ${task}`);
    return { name, pattern, task: "cleanupMissingAttachments" as const };
  });
  const elysiaPlugins = elysia ? {
    ...(optionalBoolean(elysia, "bearer") && { bearer: true }),
    ...(optionalBoolean(elysia, "serverTiming") && { serverTiming: true }),
    ...(optionalBoolean(elysia, "jwt") && { jwt: { name: "jwt", secretEnv: "QIY_JWT_SECRET" } }),
    ...(optionalBoolean(elysia, "static") && { static: { assets: "public", prefix: "/public" } }),
    ...(optionalBoolean(elysia, "html") && { html: true }),
    ...(optionalBoolean(elysia, "drizzle") && { drizzle: true }),
    ...(graphqlAdapter && { graphqlAdapter: graphqlAdapter as "native" | "yoga" | "apollo" }),
    ...(cron && { cron: jobs }),
  } : undefined;
  const storageNodes = application.children.get("storage") ?? [];
  if (storageNodes.length > 1) throw new Error("MPS XML: expected at most one StorageConfig");
  const storage = storageNodes[0];
  if (storage) only(storage, "StorageConfig", ["provider"]);
  const storageProvider = storage && required(storage, "provider");
  if (storageProvider !== undefined && storageProvider !== "local" && storageProvider !== "s3") {
    throw new Error(`MPS ${storage?.id}: storage provider must be local or s3`);
  }
  const authNodes = application.children.get("auth") ?? [];
  if (authNodes.length > 1) throw new Error("MPS XML: expected at most one AuthConfig");
  const authNode = authNodes[0];
  if (authNode) only(authNode, "AuthConfig", ["provider", "userEntity", "subjectField", "roleField"]);
  const provider = authNode && required(authNode, "provider");
  if (provider !== undefined && provider !== "oidc" && provider !== "oauth2" && provider !== "sso") {
    throw new Error(`MPS ${authNode?.id}: auth provider must be oidc, oauth2 or sso`);
  }
  const auth = authNode && {
    provider: provider as "oidc" | "oauth2" | "sso",
    userEntity: required(authNode, "userEntity"),
    subjectField: required(authNode, "subjectField"),
    roleField: required(authNode, "roleField"),
  };
  const scopes = (application.children.get("scopes") ?? []).map((node) => {
    only(node, "ScopeConfig", ["resource", "field", "claim"]);
    const resource = required(node, "resource");
    const field = required(node, "field");
    const claim = required(node, "claim");
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(resource) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field) || !/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(claim)) throw new Error(`MPS ${node.id}: invalid scope identifier`);
    return { resource, field, claim };
  });
  const menuGroups = (application.children.get("menuGroups") ?? []).map((node) => {
    only(node, "MenuGroup", ["name", "label", "icon", "parent"], ["resources"]);
    const name = required(node, "name");
    const label = node.properties.get("label") ?? name;
    const resources = (node.children.get("resources") ?? []).map((resource) => {
      only(resource, "MenuResource", ["resource"]);
      return required(resource, "resource");
    });
    return { name, label, ...(node.properties.has("icon") && { icon: node.properties.get("icon") }), ...(node.properties.has("parent") && { parent: node.properties.get("parent") }), resources };
  });
  const dashboardMetrics = (application.children.get("dashboardMetrics") ?? []).map((node) => {
    only(node, "DashboardMetric", ["name", "resource", "label", "icon", "span", "type", "groupBy", "days"]);
    const name = required(node, "name");
    const resource = required(node, "resource");
    const label = node.properties.get("label") ?? name;
    const span = optionalInteger(node, "span") ?? 8;
    if (span !== 8 && span !== 12 && span !== 24) throw new Error(`MPS ${node.id}: dashboard span must be 8, 12 or 24`);
    const type = node.properties.get("type") ?? "count";
    if (type !== "count" && type !== "distribution" && type !== "trend") throw new Error(`MPS ${node.id}: dashboard type must be count, distribution or trend`);
    const days = optionalInteger(node, "days");
    const metricType = type as "count" | "distribution" | "trend";
    return { name, resource, label, span: span as 8 | 12 | 24, ...(node.properties.has("icon") && { icon: node.properties.get("icon") }), ...(metricType !== "count" && { type: metricType }), ...(node.properties.has("groupBy") && { groupBy: node.properties.get("groupBy") }), ...(days !== undefined && { days }) };
  });
  const enums = (application.children.get("enums") ?? []).map((node) => {
    only(node, "Enum", ["name"], ["values"]);
    const name = required(node, "name");
    const values = (node.children.get("values") ?? []).map((value) => {
      only(value, "EnumValue", ["name", "label", "color", "icon"]);
      return { name: required(value, "name"), ...(value.properties.has("label") && { label: value.properties.get("label") }), ...(value.properties.has("color") && { color: value.properties.get("color") }), ...(value.properties.has("icon") && { icon: value.properties.get("icon") }) };
    });
    return { name, values };
  });
  const config = databases[0]!;
  only(config, "DatabaseConfig", ["name", "dialect", "orm"], ["extensions"]);
  if (config.properties.has("orm") && config.properties.get("orm") !== "drizzle") {
    throw new Error(`MPS ${config.id}: PostgreSQL adapter requires orm = drizzle`);
  }
  const extensions = (config.children.get("extensions") ?? []).map((extension) => {
    only(extension, "DatabaseExtension", ["name"]);
    return required(extension, "name");
  });
  const relations = (application.children.get("relations") ?? []).map(relation);
  return {
    name,
    ...(apiClient && { apiClient }),
    ...(workflows.length > 0 && { workflows }),
    ...(elysiaPlugins && { elysiaPlugins }),
    ...(storageProvider && { storageProvider }),
    ...(auth && { auth }),
    ...(scopes.length && { scopes }),
    ...(menuGroups.length && { menuGroups }),
    ...(dashboardMetrics.length && { dashboardMetrics }),
    database: {
      dialect: required(config, "dialect") as DatabaseIR["dialect"],
      extensions,
      ...(enums.length > 0 && { enums }),
      entities: (application.children.get("entities") ?? []).map((node) => {
        const parsed = entity(node);
        return { ...parsed, fields: parsed.fields.map((field) => {
          const rawType = (node.children.get("fields") ?? []).find((candidate) => candidate.properties.get("name") === field.name)?.properties.get("type");
          return rawType && enums.some((enumeration) => enumeration.name === rawType) ? { ...field, type: "Text" as const, enumName: rawType } : field;
        }) };
      }),
      ...(relations.length > 0 && { relations }),
    },
  };
}

export function parseMpsDatabaseModel(modelXml: string, structureXml: string): DatabaseIR {
  return parseMpsProjectModel(modelXml, structureXml).database;
}
