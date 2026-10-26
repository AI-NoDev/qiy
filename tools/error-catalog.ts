/**
 * Stable catalog for the errors users most often hit while writing `.qiy` models
 * or running the CLI. Codes are documentation anchors: `qiy explain --errors`
 * prints this table and `qiy explain <file>` attaches the matching code/hint to
 * parse and validation failures. Keep messages in sync with the throw sites in
 * `tools/qiy-project.ts`, `tools/database-ir.ts` and `tools/commands/skill.ts`.
 */
export interface QiyErrorCode {
  code: string;
  title: string;
  description: string;
  fix: string;
  docs: string;
  match: (message: string) => boolean;
}

const docsBase = "https://ai-nodev.github.io/qiy/dsl/errors";

export const qiyErrorCatalog: QiyErrorCode[] = [
  {
    code: "QIY1001",
    title: "Unsupported annotation",
    description: "A block or field carries an @annotation that is not valid in that context.",
    fix: "Check the annotation inventory in references/language-reference.md or docs/dsl/annotations; remove the unknown annotation.",
    docs: `${docsBase}#qiy1001`,
    match: (message) => message.includes("unsupported annotation @"),
  },
  {
    code: "QIY1002",
    title: "Duplicate annotation",
    description: "The same annotation appears more than once in one declaration.",
    fix: "Keep a single occurrence per declaration; the parser rejects duplicates instead of silently taking the last value.",
    docs: `${docsBase}#qiy1002`,
    match: (message) => message.includes("duplicate @") && message.includes("annotation"),
  },
  {
    code: "QIY1003",
    title: "Unexpected token or declaration order",
    description: "The parser reached a token it did not expect, usually because application blocks are written out of order.",
    fix: "Follow the strict order: database → mode → integration → workspace → ui → api → features → realtime → elysia → storage → auth → env → messages → permissions → workflow → enums → entities → relations → scopes/restrictions/pages → menu → dashboard/charts → dataflows → actions. Check the token index in the message.",
    docs: `${docsBase}#qiy1003`,
    match: (message) => /Expected .* near token/.test(message),
  },
  {
    code: "QIY1004",
    title: "Permission declarations require auth",
    description: "permission field/group/from/verification blocks were declared without an auth block and user entity.",
    fix: "Add an auth block (or remove the permissions). Permission evaluation needs a user row/claims to resolve groups and roles.",
    docs: `${docsBase}#qiy1004`,
    match: (message) => message.includes("Permission declarations require a generated auth block"),
  },
  {
    code: "QIY1005",
    title: "Invalid permission verification",
    description: "A permission verification input, section, operator or self set is not supported.",
    fix: "Use only the documented verification grammar: declare input fields, then compare permissions/groups/role or inputs with the supported operators.",
    docs: `${docsBase}#qiy1005`,
    match: (message) => message.startsWith("Permission verification ") && (message.includes("unsupported") || message.includes("Unknown")),
  },
  {
    code: "QIY1006",
    title: "Invalid relation",
    description: "A relation references an unknown entity/field or an invalid cardinality.",
    fix: "Declare the relation after both entities and reference existing field names: relation <name> <fromEntity> <fromField> <toEntity> <toField> one|many.",
    docs: `${docsBase}#qiy1006`,
    match: (message) => /relation|Relation/.test(message) && /unknown|Unknown|not found|does not exist/.test(message),
  },
  {
    code: "QIY1007",
    title: "Invalid chart data or property",
    description: "A chart view has an unknown/duplicate/missing property, an unsupported kind, or group by on a non-enum field.",
    fix: "Check the chart assignment grammar (icon/title/data/labels), use an enum field for group by, and declare each kind once per chart name.",
    docs: `${docsBase}#qiy1007`,
    match: (message) => /^Chart .*?(view:|:)/.test(message) || message.includes("group by field") || message.includes("Chart name"),
  },
  {
    code: "QIY1008",
    title: "Invalid generated code template",
    description: "@code is on a non-Text field or the template contains an unsupported token.",
    fix: "Put @code on a unique Text field and use documented tokens ({seq}, {seq:n}, date parts, {random:n}); inspect docs/dsl/generated-values.",
    docs: `${docsBase}#qiy1008`,
    match: (message) => /code template|@code|Generated code/i.test(message),
  },
  {
    code: "QIY1009",
    title: "Data scope claim has no matching field",
    description: "A scope declares a claim but the auth user entity (or target resource) lacks the field required to resolve it.",
    fix: "Add the claim column to the auth user entity and the scoped resources, or fix the scope field/claim names so they match.",
    docs: `${docsBase}#qiy1009`,
    match: (message) => message.includes("Data scope claim") && message.includes("matching field"),
  },
  {
    code: "QIY1010",
    title: "Invalid page/restrict rule",
    description: "A page rule or restrict policy references an undeclared role, action, field or resource.",
    fix: "Check pages/restrict against the declared resources, fields and roles (admin/operator/viewer); page field rules only hide UI, not authorization.",
    docs: `${docsBase}#qiy1010`,
    match: (message) => /^(pages|restrict) |page rule|restriction/i.test(message),
  },
  {
    code: "QIY1011",
    title: "Mode integration restriction",
    description: "A block that only applies to generated servers/standalone mode was used in integration mode.",
    fix: "Remove auth/scope/restrict/workflow/dataflow/storage/elysia/env from integration models; the host owns those concerns.",
    docs: `${docsBase}#qiy1011`,
    match: (message) => message.includes("integration") && message.includes("mode"),
  },
  {
    code: "QIY1012",
    title: "Feature flag requirement",
    description: "features apiDocs/apiKeys needs a dependency (such as an auth block) that is missing.",
    fix: "Add the required auth block/user entity, or turn the feature flag off.",
    docs: `${docsBase}#qiy1012`,
    match: (message) => /features api(Keys|Docs)/.test(message) && message.includes("requires"),
  },
  {
    code: "QIY1013",
    title: "Invalid Ant Design icon",
    description: "An @icon/chart icon name does not match Ant Design's *Outlined naming convention.",
    fix: "Use a real Ant Design Outlined icon name (for example TeamOutlined); a format-valid name that Ant Design does not export fails generated typecheck instead.",
    docs: `${docsBase}#qiy1013`,
    match: (message) => message.includes("Invalid Ant Design icon"),
  },
  {
    code: "QIY1014",
    title: "Skill has local changes",
    description: "qiy skill install/update refused to overwrite official skill files that were modified locally.",
    fix: "Review your edits, then run qiy skill install --force (or qiy skill update --force) to replace official files; unrelated files are preserved.",
    docs: `${docsBase}#qiy1014`,
    match: (message) => message.includes("Qiy skill has local changes"),
  },
  {
    code: "QIY1015",
    title: "Skill is not installed",
    description: "qiy skill update/uninstall could not find an official skill installation.",
    fix: "Run qiy skill install first, or pass --global/--dir so the command targets the directory where the skill lives.",
    docs: `${docsBase}#qiy1015`,
    match: (message) => message.includes("No Qiy skill installation") || message.includes("No official Qiy skill files"),
  },
  {
    code: "QIY1016",
    title: "Invalid sync target",
    description: "generate/init --sync was pointed at a workspace Qiy did not generate (missing .qiy-generated.json).",
    fix: "Use --sync only on a Qiy-generated workspace, or run qiy generate/qiy init without --sync for a new destination.",
    docs: `${docsBase}#qiy1016`,
    match: (message) => message.includes("--sync") && (message.includes("generated") || message.includes("manifest") || message.includes("workspace")),
  },
];

export function findQiyError(message: string): QiyErrorCode | undefined {
  return qiyErrorCatalog.find((entry) => entry.match(message));
}

export function formatQiyError(message: string): string {
  const entry = findQiyError(message);
  if (!entry) return message;
  return [
    `${message}`,
    `[${entry.code}] ${entry.title}`,
    `Fix: ${entry.fix}`,
    `Docs: ${entry.docs}`,
  ].join("\n");
}
