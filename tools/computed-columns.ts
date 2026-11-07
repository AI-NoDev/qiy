/**
 * `@computed` fields are database generated columns. The expression is rendered
 * per dialect so every database stores the same value:
 *   - a reference that is null makes a numeric result null; division by zero is
 *     null too (PostgreSQL and strict MySQL would otherwise reject the write);
 *   - operands are divided as decimals, never as integers;
 *   - Integer results truncate toward zero, Decimal/Money results round to the
 *     declared scale;
 *   - Text templates treat a null reference as the empty string.
 * PostgreSQL only has stored generated columns; MySQL and SQLite use virtual
 * ones so a migration can add them with ALTER TABLE.
 */
import { computedExpressionTokens, computedNumericTypes, type DatabaseIR, type EntityIR, type FieldIR } from "./database-ir";

type Dialect = DatabaseIR["dialect"];

function quote(dialect: Dialect, column: string): string {
  return dialect === "mysql" ? "`" + column + "`" : `"${column}"`;
}

function columnOf(entity: EntityIR, name: string): string {
  const field = entity.fields.find((candidate) => candidate.name === name);
  return field?.columnName ?? name;
}

function numericOperand(dialect: Dialect, column: string): string {
  const quoted = quote(dialect, column);
  return dialect === "postgresql" ? `CAST(${quoted} AS numeric)` : dialect === "sqlite" ? `CAST(${quoted} AS REAL)` : quoted;
}

function numericExpression(dialect: Dialect, entity: EntityIR, expression: string): string {
  const tokens = computedExpressionTokens(expression)!;
  let position = 0;
  const primary = (): string => {
    const token = tokens[position++]!;
    // Parenthesized so `- -{a}` never renders as the SQL comment marker `--`.
    if (token === "-" || token === "+") return `${token}(${primary()})`;
    if (token === "(") { const inner = sum(); position++; return `(${inner})`; }
    return token.startsWith("{") ? numericOperand(dialect, columnOf(entity, token.slice(1, -1))) : token;
  };
  const product = (): string => {
    let left = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++]!;
      const right = primary();
      left = operator === "/" ? `${left} / NULLIF(${right}, 0)` : `${left} * ${right}`;
    }
    return left;
  };
  const sum = (): string => {
    let left = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++]!;
      left = `${left} ${operator} ${product()}`;
    }
    return left;
  };
  return sum();
}

function textExpression(dialect: Dialect, entity: EntityIR, template: string): string {
  const parts = template.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/).filter(Boolean).map((part) => {
    const reference = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(part)?.[1];
    return reference ? `COALESCE(${quote(dialect, columnOf(entity, reference))}, '')` : `'${part.replace(/'/g, "''")}'`;
  });
  if (parts.length === 0) return "''";
  if (parts.length === 1) return parts[0]!;
  return dialect === "mysql" ? `CONCAT(${parts.join(", ")})` : parts.join(" || ");
}

/** The SQL generation expression of one `@computed` field. */
export function computedColumnSql(field: FieldIR, entity: EntityIR, dialect: Dialect): string {
  const expression = field.computed!;
  if (!computedNumericTypes.has(field.type)) return textExpression(dialect, entity, expression);
  const value = numericExpression(dialect, entity, expression);
  if (field.type === "Integer") {
    return dialect === "postgresql" ? `CAST(TRUNC(${value}) AS integer)` : dialect === "mysql" ? `CAST(TRUNCATE(${value}, 0) AS SIGNED)` : `CAST(${value} AS INTEGER)`;
  }
  const scale = field.scale ?? 0;
  return dialect === "postgresql" ? `CAST(${value} AS numeric(${field.precision}, ${scale}))` : dialect === "mysql" ? `CAST(${value} AS DECIMAL(${field.precision}, ${scale}))` : `ROUND(${value}, ${scale})`;
}

/** The Drizzle column modifier that turns a declared column into the generated one. */
export function drizzleGeneratedColumn(field: FieldIR, entity: EntityIR, dialect: Dialect): string {
  const expression = `sql.raw(${JSON.stringify(computedColumnSql(field, entity, dialect))})`;
  return dialect === "postgresql" ? `.generatedAlwaysAs(${expression})` : `.generatedAlwaysAs(${expression}, { mode: "virtual" })`;
}

/** True when an entity has a generated column, so its schema module imports `sql`. */
export function hasComputedColumns(database: DatabaseIR): boolean {
  return database.entities.some((entity) => entity.fields.some((field) => field.computed !== undefined));
}

function referencesOf(field: FieldIR): string[] {
  return [...new Set([...field.computed!.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!))];
}

/** The documented semantics evaluated in JavaScript; numeric results are left unrounded. */
function referenceValue(field: FieldIR, values: Record<string, string | number | null>): string | number | null {
  if (!computedNumericTypes.has(field.type)) {
    return field.computed!.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => String(values[name] ?? ""));
  }
  const tokens = computedExpressionTokens(field.computed!)!;
  let position = 0;
  const primary = (): number | null => {
    const token = tokens[position++]!;
    if (token === "-" || token === "+") { const value = primary(); return value === null ? null : token === "-" ? -value : value; }
    if (token === "(") { const value = sum(); position++; return value; }
    if (!token.startsWith("{")) return Number(token);
    const value = values[token.slice(1, -1)];
    return value === null || value === undefined ? null : Number(value);
  };
  const product = (): number | null => {
    let left = primary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++]!;
      const right = primary();
      left = left === null || right === null || (operator === "/" && right === 0) ? null : operator === "*" ? left * right : left / right;
    }
    return left;
  };
  const sum = (): number | null => {
    let left = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++]!;
      const right = product();
      left = left === null || right === null ? null : operator === "+" ? left + right : left - right;
    }
    return left;
  };
  const value = sum();
  return value === null ? null : field.type === "Integer" ? Math.trunc(value) : value;
}

function sampleLiteral(dialect: Dialect, field: FieldIR, value: string | number | null): string {
  if (field.type === "Integer") {
    const literal = value === null ? "NULL" : String(value);
    return dialect === "postgresql" ? `CAST(${literal} AS integer)` : dialect === "mysql" ? `CAST(${literal} AS SIGNED)` : literal;
  }
  if (computedNumericTypes.has(field.type)) {
    const literal = value === null ? "NULL" : String(value);
    const type = `(${field.precision}, ${field.scale ?? 0})`;
    return dialect === "postgresql" ? `CAST(${literal} AS numeric${type})` : dialect === "mysql" ? `CAST(${literal} AS DECIMAL${type})` : literal;
  }
  const literal = value === null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
  return dialect === "postgresql" ? `CAST(${literal} AS text)` : dialect === "mysql" ? `CAST(${literal} AS CHAR)` : literal;
}

/**
 * Generated test that evaluates every generation expression on the target database
 * against sample operands and against null operands, and compares the result with
 * the documented semantics. PostgreSQL and MySQL cases skip without QIY_TEST_DATABASE_URL.
 */
export function renderComputedColumnsTest(database: DatabaseIR): string | undefined {
  const dialect = database.dialect;
  const cases = database.entities.flatMap((entity) => entity.fields.filter((field) => field.computed !== undefined).flatMap((field) => {
    const references = referencesOf(field).map((name) => entity.fields.find((candidate) => candidate.name === name)!);
    const samples = Object.fromEntries(references.map((reference, index) => [reference.name, reference.type === "Integer" ? index * 2 + 5 : computedNumericTypes.has(reference.type) ? `${index + 2}.25` : `v${index + 1}`]));
    const nulls = Object.fromEntries(references.map((reference) => [reference.name, null]));
    return [["sample operands", samples], ["null operands", nulls]].map(([label, values]) => {
      const operands = references.map((reference) => `${sampleLiteral(dialect, reference, (values as Record<string, string | number | null>)[reference.name]!)} AS ${quote(dialect, reference.columnName ?? reference.name)}`).join(", ");
      const expected = referenceValue(field, values as Record<string, string | number | null>);
      return {
        name: `${entity.tableName}.${field.name} with ${label as string}`,
        sql: `SELECT ${computedColumnSql(field, entity, dialect)} AS value FROM (SELECT ${operands}) AS qiy_sample`,
        expected,
        tolerance: typeof expected === "number" && field.type !== "Integer" ? 10 ** -(field.scale ?? 0) : 0,
      };
    });
  }));
  if (cases.length === 0) return undefined;
  const read = dialect === "sqlite"
    ? "return (client.query(sql).get() as { value: unknown }).value;"
    : dialect === "postgresql"
      ? "return ((await client.unsafe(sql)) as Array<{ value: unknown }>)[0]!.value;"
      : "const [rows] = await client.query(sql) as unknown as [Array<{ value: unknown }>];\n  return rows[0]!.value;";
  return `import { expect, test } from "bun:test";

const available = ${dialect === "sqlite" ? "true" : "Boolean(Bun.env.QIY_TEST_DATABASE_URL)"};
const dbTest = available ? test : test.skip;
const cases: Array<{ name: string; sql: string; expected: string | number | null; tolerance: number }> = ${JSON.stringify(cases, null, 2)};

async function evaluate(sql: string): Promise<unknown> {
  const { client } = await import("../src/db");
  ${read}
}

for (const item of cases) {
  dbTest("generated column " + item.name, async () => {
    const value = await evaluate(item.sql);
    if (item.expected === null) expect(value).toBeNull();
    else if (typeof item.expected === "number") expect(Math.abs(Number(value) - item.expected)).toBeLessThanOrEqual(item.tolerance);
    else expect(value).toBe(item.expected);
  });
}
`;
}

/** The SQLite DDL of a generated column, for generated tests that create their own tables. */
export function sqliteComputedColumnDdl(field: FieldIR, entity: EntityIR): string {
  const type = field.type === "Integer" ? "integer" : computedNumericTypes.has(field.type) ? "real" : "text";
  return `${quote("sqlite", field.columnName ?? field.name)} ${type} GENERATED ALWAYS AS (${computedColumnSql(field, entity, "sqlite")}) VIRTUAL${field.nullable ? "" : " not null"}`;
}
