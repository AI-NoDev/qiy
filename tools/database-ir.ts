export type DatabaseDialect = "postgresql" | "mysql" | "sqlite";
export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "DateTime" | "File" | "Files" | "Vector";
export type FilterMode = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";

export interface EnumValueIR {
  name: string;
  label?: string;
  color?: string;
  icon?: string;
  comment?: string;
  commentKey?: string;
}

export interface EnumIR {
  name: string;
  comment?: string;
  commentKey?: string;
  values: EnumValueIR[];
}

export interface FieldIR {
  name: string;
  comment?: string;
  commentKey?: string;
  columnName?: string;
  type: FieldType;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  extension?: string;
  dimension?: number;
  precision?: number;
  scale?: number;
  enumName?: string;
  label?: string;
  icon?: string;
  visible?: boolean;
  listVisible?: boolean;
  formVisible?: boolean;
  showVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  filterModes?: FilterMode[];
  uploadMode?: "binary" | "base64" | "both";
  maxBytes?: number;
  mimeTypes?: string[];
  maxFiles?: number;
}

export interface IndexColumnIR {
  fieldName: string;
  opclass?: string;
}

export interface IndexIR {
  name: string;
  comment?: string;
  commentKey?: string;
  method: "btree" | "hnsw" | "ivfflat";
  columns: IndexColumnIR[];
  unique?: boolean;
  concurrently?: boolean;
}

export interface RelationIR {
  name: string;
  comment?: string;
  commentKey?: string;
  fromEntity: string;
  fromField: string;
  toEntity: string;
  toField: string;
  cardinality: "one" | "many";
  onDelete?: "restrict" | "cascade" | "setNull";
}

export interface EntityIR {
  name: string;
  comment?: string;
  commentKey?: string;
  tableName: string;
  fields: FieldIR[];
  indexes?: IndexIR[];
  label?: string;
  icon?: string;
}

export interface DatabaseIR {
  comment?: string;
  commentKey?: string;
  dialect: DatabaseDialect;
  extensions: string[];
  entities: EntityIR[];
  enums?: EnumIR[];
  relations?: RelationIR[];
}

const identifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const vectorOpclasses = new Set(["vector_l2_ops", "vector_ip_ops", "vector_cosine_ops"]);
const reservedNames = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "null", "return", "super", "switch", "this",
  "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

export function validateDatabaseIR(database: DatabaseIR): string[] {
  const errors: string[] = [];
  if (!database || !Array.isArray(database.entities) || !Array.isArray(database.extensions)) {
    return ["Database IR requires entities and extensions arrays"];
  }
  if (!["postgresql", "mysql", "sqlite"].includes(database.dialect)) {
    errors.push("Unsupported database dialect");
  }
  const extensions = new Set(database.extensions);
  const entityNames = new Set<string>();
  const tableNames = new Set<string>();
  const indexNames = new Set<string>();
  const enumNames = new Set<string>();
  const relationNames = new Set<string>();

  for (const enumeration of database.enums ?? []) {
    if (!enumeration || !identifier.test(enumeration.name) || enumNames.has(enumeration.name)) {
      errors.push(`Enum ${enumeration?.name ?? "<unknown>"}: invalid or duplicate name`);
      continue;
    }
    enumNames.add(enumeration.name);
    if (!Array.isArray(enumeration.values) || enumeration.values.length === 0) {
      errors.push(`Enum ${enumeration.name}: values must be a non-empty array`);
      continue;
    }
    const valueNames = new Set<string>();
    for (const value of enumeration.values ?? []) {
      if (!value || !identifier.test(value.name) || valueNames.has(value.name)) {
        errors.push(`Enum ${enumeration.name}.${value?.name ?? "<unknown>"}: invalid or duplicate value`);
        continue;
      }
      valueNames.add(value.name);
    }
  }

  for (const relation of database.relations ?? []) {
    if (!relation || !identifier.test(relation.name) || relationNames.has(relation.name)) {
      errors.push(`Relation ${relation?.name ?? "<unknown>"}: invalid or duplicate name`);
      continue;
    }
    relationNames.add(relation.name);
    if (!["one", "many"].includes(relation.cardinality)) errors.push(`Relation ${relation.name}: cardinality must be one or many`);
  }

  if (database.dialect !== "postgresql" && (extensions.has("pgvector") || extensions.has("postgis"))) {
    errors.push("pgvector and postgis require PostgreSQL");
  }

  for (const entity of database.entities) {
    if (!identifier.test(entity.name) || reservedNames.has(entity.name) || !entity.tableName) {
      errors.push(`Entity ${entity.name}: invalid name or tableName`);
    }
    if (entityNames.has(entity.name) || tableNames.has(entity.tableName)) {
      errors.push(`Entity ${entity.name}: duplicate entity or table name`);
    }
    entityNames.add(entity.name);
    tableNames.add(entity.tableName);
    if (!Array.isArray(entity.fields)) {
      errors.push(`Entity ${entity.name}: fields must be an array`);
      continue;
    }
    if (entity.indexes !== undefined && !Array.isArray(entity.indexes)) {
      errors.push(`Entity ${entity.name}: indexes must be an array`);
      continue;
    }

    const fields = new Map<string, FieldIR>();
    const columnNames = new Set<string>();
    for (const field of entity.fields) {
      if (!identifier.test(field.name) || fields.has(field.name)) {
        errors.push(`${entity.name}.${field.name}: invalid or duplicate field name`);
      }
      if (!field.columnName && field.columnName !== undefined) {
        errors.push(`${entity.name}.${field.name}: empty columnName`);
      }
      const columnName = field.columnName ?? field.name;
      if (columnNames.has(columnName)) {
        errors.push(`${entity.name}.${field.name}: duplicate column name ${columnName}`);
      }
      columnNames.add(columnName);
      fields.set(field.name, field);
      if (!["UUID", "Text", "Integer", "Decimal", "Money", "DateTime", "File", "Files", "Vector"].includes(field.type)) {
        errors.push(`${entity.name}.${field.name}: unsupported field type`);
        continue;
      }
      if (field.enumName && !enumNames.has(field.enumName)) {
        errors.push(`${entity.name}.${field.name}: unknown enum ${field.enumName}`);
      }
      if (field.enumName && field.type !== "Text") {
        errors.push(`${entity.name}.${field.name}: enum fields require Text storage`);
      }
      if (field.extension && !extensions.has(field.extension)) {
        errors.push(`${entity.name}.${field.name}: undeclared extension ${field.extension}`);
      }
      const hasUploadPolicy = field.uploadMode !== undefined || field.maxBytes !== undefined || field.mimeTypes !== undefined || field.maxFiles !== undefined;
      const uploadCapable = field.type === "File" || field.type === "Files";
      if (hasUploadPolicy && !uploadCapable) errors.push(`${entity.name}.${field.name}: upload policy requires File or Files type`);
      if (uploadCapable) {
        if (field.uploadMode !== undefined && !["binary", "base64", "both"].includes(field.uploadMode)) errors.push(`${entity.name}.${field.name}: invalid upload mode`);
        if (field.maxBytes !== undefined && (!Number.isSafeInteger(field.maxBytes) || field.maxBytes < 1 || field.maxBytes > 100 * 1024 * 1024)) errors.push(`${entity.name}.${field.name}: invalid maxBytes`);
        // A single File holds one key; multiple keys need the Files type instead of a larger maxFiles.
        if (field.type === "File" && field.maxFiles !== undefined && field.maxFiles !== 1) errors.push(`${entity.name}.${field.name}: File supports maxFiles 1; use the Files type for multiple files`);
        if (field.type === "Files" && field.maxFiles !== undefined && (!Number.isSafeInteger(field.maxFiles) || field.maxFiles < 1 || field.maxFiles > 20)) errors.push(`${entity.name}.${field.name}: Files maxFiles must be an integer from 1 to 20`);
        if (field.mimeTypes !== undefined && (!field.mimeTypes.length || new Set(field.mimeTypes).size !== field.mimeTypes.length || field.mimeTypes.some((mime) => !/^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/.test(mime)))) errors.push(`${entity.name}.${field.name}: invalid MIME types`);
      }
      if (field.type === "Files") {
        if (field.primaryKey) errors.push(`${entity.name}.${field.name}: Files cannot be a primary key`);
        if (field.unique) errors.push(`${entity.name}.${field.name}: Files cannot be unique`);
      }

      if (field.type === "Vector") {
        if (database.dialect !== "postgresql" || field.extension !== "pgvector" || !extensions.has("pgvector")) {
          errors.push(`${entity.name}.${field.name}: Vector requires PostgreSQL and a declared pgvector extension`);
        }
        if (!Number.isSafeInteger(field.dimension) || (field.dimension ?? 0) <= 0) {
          errors.push(`${entity.name}.${field.name}: Vector dimension must be a positive integer`);
        }
        if ((field.dimension ?? 0) > 16000) {
          errors.push(`${entity.name}.${field.name}: pgvector vector dimension cannot exceed 16000`);
        }
      }

      if (field.type === "Decimal" || field.type === "Money") {
        if (!Number.isSafeInteger(field.precision) || (field.precision ?? 0) <= 0) {
          errors.push(`${entity.name}.${field.name}: precision must be a positive integer`);
        }
        const maximumPrecision = database.dialect === "mysql" ? 65 : database.dialect === "postgresql" ? 1000 : undefined;
        if (maximumPrecision !== undefined && (field.precision ?? 0) > maximumPrecision) {
          errors.push(`${entity.name}.${field.name}: ${database.dialect} precision cannot exceed ${maximumPrecision}`);
        }
        if (database.dialect === "mysql" && (field.scale ?? 0) > 30) {
          errors.push(`${entity.name}.${field.name}: mysql scale cannot exceed 30`);
        }
      } else if (field.precision !== undefined || field.scale !== undefined) {
        errors.push(`${entity.name}.${field.name}: precision and scale require Decimal or Money`);
      }
      if (field.type !== "Vector" && field.dimension !== undefined) {
        errors.push(`${entity.name}.${field.name}: dimension requires Vector`);
      }
      if (field.scale !== undefined && (!Number.isSafeInteger(field.scale) || field.scale < 0 || field.scale > (field.precision ?? 0))) {
        errors.push(`${entity.name}.${field.name}: scale must be between zero and precision`);
      }
    }

    for (const index of entity.indexes ?? []) {
      if (!index || !Array.isArray(index.columns)) {
        errors.push(`Entity ${entity.name}: index columns must be an array`);
        continue;
      }
      if (indexNames.has(index.name)) {
        errors.push(`${entity.name}.${index.name}: duplicate index name`);
      }
      indexNames.add(index.name);
      if (!["btree", "hnsw", "ivfflat"].includes(index.method)) {
        errors.push(`${entity.name}.${index.name}: unsupported index method`);
        continue;
      }
      if (!index.name || index.columns.length === 0) {
        errors.push(`${entity.name}.${index.name}: an index needs a name and columns`);
      }
      if (index.method === "hnsw" || index.method === "ivfflat") {
        if (database.dialect !== "postgresql" || !extensions.has("pgvector")) {
          errors.push(`${entity.name}.${index.name}: ${index.method} requires PostgreSQL and pgvector`);
        }
        if (index.unique || index.columns.length !== 1) {
          errors.push(`${entity.name}.${index.name}: vector index must have one column and cannot be unique`);
        }
      }
      if (index.concurrently && database.dialect !== "postgresql") {
        errors.push(`${entity.name}.${index.name}: concurrently requires PostgreSQL`);
      }
      for (const column of index.columns) {
        const field = fields.get(column.fieldName);
        if (!field) {
          errors.push(`${entity.name}.${index.name}: unknown field ${column.fieldName}`);
        }
        if (index.method === "hnsw" || index.method === "ivfflat") {
          if (field?.type === "Vector" && (field.dimension ?? 0) > 2000) {
            errors.push(`${entity.name}.${index.name}: ${index.method} vector dimension cannot exceed 2000`);
          }
          if (field?.type !== "Vector" || !column.opclass || !vectorOpclasses.has(column.opclass)) {
            errors.push(`${entity.name}.${index.name}: vector index requires a Vector field and compatible opclass`);
          }
        } else if (column.opclass) {
          errors.push(`${entity.name}.${index.name}: btree opclass is not supported by this adapter`);
        }
      }
    }
  }

  const entitiesByName = new Map(database.entities.map((entity) => [entity.name, entity]));
  const relationSources = new Set<string>();
  for (const relation of database.relations ?? []) {
    const source = `${relation.fromEntity}.${relation.fromField}`;
    if (relationSources.has(source)) errors.push(`Relation ${relation.name}: duplicate source field ${source}`);
    relationSources.add(source);
    if (relation.cardinality !== "one") errors.push(`Relation ${relation.name}: only one-to-one/many-to-one foreign keys are supported; model many-to-many with an explicit join entity`);
    if (relation.onDelete && !["restrict", "cascade", "setNull"].includes(relation.onDelete)) errors.push(`Relation ${relation.name}: unsupported onDelete action`);
    const from = entitiesByName.get(relation.fromEntity);
    const to = entitiesByName.get(relation.toEntity);
    if (!from || !to) {
      errors.push(`Relation ${relation.name}: referenced entity does not exist`);
      continue;
    }
    if (!from.fields.some((field) => field.name === relation.fromField)) errors.push(`Relation ${relation.name}: unknown source field ${relation.fromEntity}.${relation.fromField}`);
    if (!to.fields.some((field) => field.name === relation.toField)) errors.push(`Relation ${relation.name}: unknown target field ${relation.toEntity}.${relation.toField}`);
    const fromField = from.fields.find((field) => field.name === relation.fromField);
    const toField = to.fields.find((field) => field.name === relation.toField);
    if (fromField && toField && (fromField.type !== "UUID" || toField.type !== "UUID")) errors.push(`Relation ${relation.name}: V3 foreign keys require UUID fields`);
    if (toField && !toField.primaryKey && !toField.unique) errors.push(`Relation ${relation.name}: target field must be primary or unique`);
    if (relation.onDelete === "setNull" && fromField && !fromField.nullable) errors.push(`Relation ${relation.name}: setNull requires a nullable source field`);
  }

  return errors;
}
