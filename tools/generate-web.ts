import type { DatabaseIR, EnumIR, EnumValueIR, FieldIR } from "./database-ir";
import { renderAppTemplate } from "./admin-template";
import { generatedFieldKind, generatedFieldsOf, manyRelations, validateDatabaseIR } from "./database-ir";
import { fieldRulesOf, formDefault } from "./field-rules";
import type { QiyChart, QiyChartView, QiyProject } from "./qiy-project";
import { authHasLocal, authIsHybrid, authOAuthProviders, authProviderLabel as providerLabel, authUsesProviderChooser, qiyChartVariants } from "./qiy-project";
import { evaluatePermissionExpression, requiredPermissionValues, type QiyPermissionExpressionIR } from "./permissions";
import { roleAccessTable, roleContext } from "./roles";
import { renderMultiProviderWebClient, renderHybridWebClient, renderAccountWebClient, renderOnboardingRoute, renderProfileRoute } from "./web/auth";
import { renderWebFeaturesModule, renderWebDocsModule, renderWebApiKeysModule, renderWebMermaidComponent, renderWebDocsPageComponent, renderWebDocsRoute, renderWebApiDocsPageComponent, renderWebApiDocsRoute, renderWebApiKeysPageComponent, renderWebApiKeysRoute, renderWebFeaturesTest, renderWebOverviewTest, renderWebApiDocsTest, renderWebApiKeysTest, renderWebOverviewRenderTest, renderWebApiDocsRenderTest, renderWebApiKeysRenderTest } from "./web/api-keys-docs";
import { addRealtimeFiles } from "./web/realtime";
import type { GeneratedAction, WebOptions } from "./web/shared";
import { renderExportFiles, renderExportTestFiles } from "./web/export";
import { renderI18nFiles, renderI18nTestFiles } from "./web/i18n";
import { renderViewFiles, renderViewTestFiles } from "./web/views";

/**
 * Stable, model-derived translation keys. Every label a generated page renders
 * keeps its declared (or identifier) text as the fallback and is looked up in the
 * project `messages` dictionary through this key, so a model can be translated
 * without hand-editing generated code. Keys are derived only from declared
 * identifiers, never from user text, so they are stable across label edits.
 */
export const qiyModelKeys = {
  resourceLabel: (resource: string) => `qiy.resources.${resource}.label`,
  resourceSingular: (resource: string) => `qiy.resources.${resource}.singular`,
  resourcePlural: (resource: string) => `qiy.resources.${resource}.plural`,
  fieldLabel: (resource: string, field: string) => `qiy.resources.${resource}.fields.${field}.label`,
  enumLabel: (enumeration: string) => `qiy.enums.${enumeration}.label`,
  enumValueLabel: (enumeration: string, value: string) => `qiy.enums.${enumeration}.values.${value}`,
  menuLabel: (group: string) => `qiy.menu.${group}.label`,
  chartLabel: (chart: string) => `qiy.charts.${chart}.label`,
  chartViewLabel: (chart: string, kind: string) => `qiy.charts.${chart}.views.${kind}.label`,
  chartLabelValue: (chart: string, value: string) => `qiy.charts.${chart}.labels.${value}`,
  actionLabel: (action: string) => `qiy.actions.${action}.label`,
  actionConfirm: (action: string) => `qiy.actions.${action}.confirm`,
  actionInputLabel: (action: string, input: string) => `qiy.actions.${action}.inputs.${input}.label`,
} as const;

/** Field-name heuristics shared by relation targets and display fallbacks. */
const naturalLabelFields = ["name", "title", "displayName", "code", "number", "sku", "email", "label", "inventoryKey"] as const;

/** Fallback chain for a resource display template: declared template, then the first human-readable field. */
function naturalDisplayField(entity: { fields: FieldIR[] }): FieldIR | undefined {
  return naturalLabelFields.map((name) => entity.fields.find((field) => field.name === name && field.type !== "File" && field.type !== "Files" && field.type !== "Vector")).find(Boolean);
}

function displayTemplateFor(declared: string | undefined, fallbackField?: FieldIR | undefined): string | undefined {
  return declared ?? (fallbackField ? `{$.${fallbackField.name}}` : undefined);
}

function enumerationDefinitions(database: DatabaseIR): Array<EnumIR & { label: string; labelKey: string; values: Array<EnumValueIR & { label: string; labelKey: string }> }> {
  return (database.enums ?? []).map((enumeration) => ({
    ...enumeration,
    label: enumeration.name,
    labelKey: qiyModelKeys.enumLabel(enumeration.name),
    values: enumeration.values.map((value) => ({ ...value, label: value.label ?? value.name, labelKey: qiyModelKeys.enumValueLabel(enumeration.name, value.name) })),
  }));
}

function resourceFields(database: DatabaseIR, menuGroups: NonNullable<QiyProject["menuGroups"]>, realtime?: QiyProject["realtime"], pages: NonNullable<QiyProject["pages"]> = []): string {
  const enumByName = new Map(enumerationDefinitions(database).map((enumeration) => [enumeration.name, enumeration.values]));
  const entityByName = new Map(database.entities.map((entity) => [entity.name, entity]));
  const generatedByEntity = new Map(database.entities.map((entity) => [entity.name, new Set(generatedFieldsOf(entity, database.relations ?? []).map((generated) => generated.field.name))]));
  const parentByResource = new Map(menuGroups.flatMap((group) => group.resources.map((resource) => [resource, `menu-${group.name}`] as const)));
  const liveModeByResource = new Map((realtime?.resources ?? []).map((subscription) => [subscription.resource, realtime!.mode] as const));
  // Page-level field layout: a field with roles is only rendered for those roles.
  const fieldRolesByResource = new Map(pages.filter((page) => page.fields?.length).map((page) => [page.resource, new Map(page.fields!.map((entry) => [entry.field, entry.roles]))]));
  const viewResources = (database.views ?? []).map((view) => {
    const source = database.entities.find((entity) => entity.name === view.from || entity.tableName === view.from)!;
    const displayField = view.columns.find((column) => source.fields.find((field) => field.name === column)?.type === "Text");
    return {
      name: view.name,
      apiName: view.name,
      label: view.name,
      labelKey: qiyModelKeys.resourceLabel(view.name),
      singular: view.name,
      singularKey: qiyModelKeys.resourceSingular(view.name),
      plural: view.name,
      pluralKey: qiyModelKeys.resourcePlural(view.name),
      ...(displayField && { displayTemplate: `{$.${displayField}}` }),
      icon: "TableOutlined",
      liveMode: "off",
      readOnly: true,
      hasDetail: view.columns.includes("id"),
      fields: view.columns.map((name) => {
        const field = source.fields.find((candidate) => candidate.name === name)!;
        return {
          name: field.name,
          label: field.label ?? field.name,
          labelKey: qiyModelKeys.fieldLabel(view.name, field.name),
          type: field.type,
          ...(field.itemType && { itemType: field.itemType }),
          nullable: Boolean(field.nullable),
          primaryKey: Boolean(field.primaryKey),
          visible: true,
          listVisible: true,
          formVisible: false,
          showVisible: true,
          sortable: false,
          filterable: false,
          filterModes: [],
        };
      }),
    };
  });
  return JSON.stringify([...database.entities.map((entity) => {
    const displayField = naturalDisplayField(entity);
    const displayTemplate = displayTemplateFor(entity.display, displayField);
    // A table cell and its drawer should show the same text unless the model
    // declares a dedicated table display; both fall back to the entity display.
    const tableDisplayTemplate = entity.tableDisplay ?? displayTemplate;
    const relationDetailTemplate = entity.relationDetail ?? displayTemplate;
    return {
    name: entity.tableName,
    apiName: entity.name,
    label: entity.label ?? entity.name,
    labelKey: qiyModelKeys.resourceLabel(entity.tableName),
    singular: entity.singular ?? entity.label ?? entity.name,
    singularKey: qiyModelKeys.resourceSingular(entity.tableName),
    plural: entity.plural ?? entity.label ?? entity.name,
    pluralKey: qiyModelKeys.resourcePlural(entity.tableName),
    ...(displayTemplate !== undefined && { displayTemplate }),
    ...(tableDisplayTemplate !== undefined && { tableDisplayTemplate }),
    ...(relationDetailTemplate !== undefined && { relationDetailTemplate }),
    ...(entity.comment !== undefined && { comment: entity.comment }),
    ...(entity.commentKey !== undefined && { commentKey: entity.commentKey }),
    icon: entity.icon ?? (entity.name.toLowerCase().includes("user") ? "UserOutlined" : entity.name.toLowerCase().includes("order") ? "ShoppingOutlined" : entity.name.toLowerCase().includes("warehouse") ? "DatabaseOutlined" : "TableOutlined"),
    liveMode: liveModeByResource.get(entity.tableName) ?? "off",
    ...(entity.fields.some((field) => field.softDelete) && { softDelete: true }),
    ...(entity.fields.some((field) => field.version) && { versionField: entity.fields.find((field) => field.version)!.name }),
    ...(parentByResource.has(entity.tableName) && { menuParent: parentByResource.get(entity.tableName) }),
    ...(database.relations?.some((relation) => relation.toEntity === entity.name) && { relatedResources: database.relations.filter((relation) => relation.toEntity === entity.name).map((relation) => ({ resource: entityByName.get(relation.fromEntity)!.tableName, field: relation.fromField, label: entityByName.get(relation.fromEntity)!.label ?? entityByName.get(relation.fromEntity)!.name, labelKey: qiyModelKeys.resourceLabel(entityByName.get(relation.fromEntity)!.tableName) })) }),
    fields: entity.fields.map((field): Record<string, unknown> => {
      const relation = (database.relations ?? []).find((candidate) => candidate.fromEntity === entity.name && candidate.fromField === field.name);
      const target = relation && entityByName.get(relation.toEntity);
      return {
      name: field.name,
      label: field.label ?? field.name,
      labelKey: qiyModelKeys.fieldLabel(entity.tableName, field.name),
      ...(field.comment !== undefined && { comment: field.comment }),
      ...(field.commentKey !== undefined && { commentKey: field.commentKey }),
      type: field.type,
      ...(field.itemType && { itemType: field.itemType }),
      nullable: Boolean(field.nullable),
      primaryKey: Boolean(field.primaryKey),
      visible: field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      listVisible: field.listVisible ?? field.visible ?? (!field.primaryKey && !field.version && field.type !== "Vector"),
      formVisible: field.stateMachine ? false : field.formVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      showVisible: field.showVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      sortable: field.sortable ?? true,
      filterable: field.filterable ?? true,
      filterModes: field.filterModes ?? (field.enumName ? ["eq"] : field.type === "Text" || field.type === "Email" || field.type === "URL" ? ["contains", "startsWith", "endsWith", "eq"] : field.type === "Boolean" || field.type === "JSON" || field.type === "Array" ? ["eq"] : ["eq", "gt", "gte", "lt", "lte", "between", "in"]),
      ...((field.type === "File" || field.type === "Files") && { uploadMode: field.uploadMode ?? "binary", maxBytes: field.maxBytes ?? 25 * 1024 * 1024, mimeTypes: field.mimeTypes ?? ["*/*"], maxFiles: field.type === "Files" ? field.maxFiles ?? 6 : 1 }),
      ...(field.enumName && { enumName: field.enumName, enumValues: enumByName.get(field.enumName) ?? [] }),
      ...(target && { relation: { resource: target.tableName, labelField: naturalDisplayField(target)?.name ?? "id" } }),
      // Generated values are filled by the server: hidden on create, read-only on
      // edit, and always displayed normally on list/show pages.
      ...(generatedByEntity.get(entity.name)?.has(field.name) && { autoGenerated: true }),
      ...(field.softDelete && { autoGenerated: true }),
      ...(field.version && { autoGenerated: true }),
      ...(field.tenantClaim !== undefined && { autoGenerated: true }),
      ...(field.computed !== undefined && { autoGenerated: true }),
      ...(field.icon && { icon: field.icon }),
      ...(fieldRolesByResource.get(entity.tableName)?.has(field.name) && { roles: fieldRolesByResource.get(entity.tableName)!.get(field.name) }),
      ...(field.type === "Vector" && { dimension: field.dimension }),
      ...(fieldRulesOf(field) && { rules: fieldRulesOf(field) }),
      ...(field.defaultValue && { defaulted: true }),
      ...(formDefault(field) !== undefined && { defaultValue: formDefault(field) }),
    }; }).concat(manyRelations(database, entity.name).map((link) => ({
      name: link.field,
      label: link.field,
      labelKey: qiyModelKeys.fieldLabel(entity.tableName, link.field),
      ...(link.relation.comment !== undefined && { comment: link.relation.comment }),
      ...(link.relation.commentKey !== undefined && { commentKey: link.relation.commentKey }),
      type: "UUID",
      nullable: true,
      primaryKey: false,
      visible: true,
      listVisible: true,
      formVisible: true,
      showVisible: true,
      sortable: false,
      filterable: true,
      filterModes: ["in", "eq"],
      many: true,
      relation: { resource: link.target.tableName, labelField: naturalDisplayField(link.target)?.name ?? "id" },
      ...(fieldRolesByResource.get(entity.tableName)?.has(link.field) && { roles: fieldRolesByResource.get(entity.tableName)!.get(link.field) }),
    }))),
  }; }), ...viewResources], null, 2);
}

function editable(field: FieldIR): boolean { return !field.primaryKey && field.type !== "Vector"; }

export function generateWeb(database: DatabaseIR, options: WebOptions = {}): Record<string, string> {
  const ui = options.ui ?? { library: "antd", theme: "blue", themes: ["blue", "purple", "green", "orange", "red"], colorMode: "system", allowThemeSwitch: true, allowColorModeSwitch: true } as const;
  if (ui.library !== "antd") throw new Error(`Unsupported UI library ${ui.library}; only antd is implemented`);
  const hasSoftDelete = !options.readOnly && database.entities.some((entity) => entity.fields.some((field) => field.softDelete));
  const treeEntities = Object.fromEntries([...new Set((options.scopes ?? []).flatMap((scope) => scope.tree ? [[scope.tree.entity, scope.tree.parentField] as const] : []))].map(([entity, parentField]) => [entity, { parentField, labelField: "name" }]));
  const authOAuthProviderIds = options.auth ? authOAuthProviders(options.auth) : [];
  const hasLocalAuth = Boolean(options.auth && authHasLocal(options.auth));
  const hybridAuth = Boolean(options.auth && authIsHybrid(options.auth));
  const providerChooserAuth = Boolean(options.auth && authUsesProviderChooser(options.auth));
  const multiProviderAuth = Boolean(options.auth && providerChooserAuth && !hybridAuth);
  const usesOidcAuth = Boolean(options.auth && !hasLocalAuth && authOAuthProviderIds.length > 0 && options.auth.provider !== "local" && options.auth.provider !== "otp");
  const usesOtpAuth = options.auth?.provider === "otp";
  const authProviderLabel = options.auth ? (options.auth.provider === "otp" ? "One-time password" : options.auth.provider === "local" ? "local" : providerLabel(options.auth, options.auth.provider)) : "";
  const userEntity = options.auth ? database.entities.find((entity) => entity.name === options.auth!.userEntity) : undefined;
  // The generated profile page renders the signed-in role; when the role field is
  // a declared enum, its localized value label comes from the model dictionary.
  const authRoleEnumName = options.auth ? userEntity?.fields.find((field) => field.name === options.auth!.roleField)?.enumName : undefined;
  // The hybrid onboarding form asks for a separate email only when the user
  // entity declares one that is not already the username field.
  const onboardingEmailField = userEntity?.fields.some((field) => field.name === "email") && options.auth?.usernameField !== "email" ? "email" : null;
  const onboardingUsernameLabel = options.auth?.usernameField === "email" ? "Email" : "Username";
  const integrationAuth = options.mode === "integration" && options.integration?.authTransport !== "none";
  const usesAuth = Boolean(options.auth || integrationAuth);
  const resourceRolePolicies = (options.restrictions ?? []).filter((restriction) => restriction.roles?.length).map((restriction) => ({ resource: restriction.resource, roles: restriction.roles }));
  const resourcePolicyDeclaration = resourceRolePolicies.length ? `const resourcePolicies: Array<{ resource: string; roles: string[] }> = ${JSON.stringify(resourceRolePolicies)};\n` : "";
  // The generated access-control test must describe this model's own resources and
  // allow lists; hardcoding demo resource names fails for restricted projects.
  // Mirrors the generated provider: full and write roles may mutate non-user resources,
  // read roles are read-only, and a resource allow list narrows every action.
  const roles = roleContext(options.auth);
  const roleAccess = roleAccessTable(options.auth);
  const roleActions: Record<string, string[]> = Object.fromEntries(roles.names.map((role) => [role, roleAccess[role] === "read" ? ["list", "show"] : ["list", "show", "create", "edit", "delete"]]));
  const modelResources = database.entities.map((entity) => entity.name);
  // Prefer a business resource: the generated provider treats user administration as
  // admin-only, so deriving expectations from it would need a special case everywhere.
  const candidateResources = modelResources.filter((name) => name !== options.auth?.userEntity);
  const policyResource = candidateResources.find((name) => resourceRolePolicies.some((policy) => policy.resource === name)) ?? candidateResources[0] ?? modelResources[0];
  const roleExpectations = (role: string, anonymous = false): string[] => {
    if (!policyResource) return [];
    const policy = resourceRolePolicies.find((item) => item.resource === policyResource);
    const page = (options.pages ?? []).find((item) => item.resource === policyResource);
    const adminOnly = policyResource === options.auth?.userEntity;
    const allowed = !anonymous && (adminOnly ? roleAccess[role] === "full" : policy?.roles ? (policy.roles as string[]).includes(role) : true);
    // A page rule narrows (or widens) the per-action expectation for its resource.
    const expected = (action: string) => {
      const pageRule = page?.actions.find((entry) => entry.action === action);
      if (pageRule) return allowed && (pageRule.roles as string[]).includes(role);
      return allowed && (adminOnly ? roleAccess[role] === "full" : (roleActions[role] ?? []).includes(action));
    };
    return ["list", "show", "create", "edit", "delete"].map((action) => `  expect((await qiyAccessControlProvider.can({ resource: ${JSON.stringify(policyResource)}, action: "${action}" })).can).toBe(${expected(action)});`);
  };
  const resourcePolicyCheck = resourceRolePolicies.length ? `const resourcePolicy = resourcePolicies.find((policy) => policy.resource === resource); if (resourcePolicy && !resourcePolicy.roles.includes(identity.role ?? "")) return { can: false, reason: "Resource access is restricted" }; ` : "";
  // Page-level rules refine the role model per page action; the API guard enforces
  // the same table, so hiding a button here matches an actual denial there.
  const pageRuleEntries = (options.pages ?? []).flatMap((page) => page.actions.map((entry) => ({ resource: page.resource, action: entry.action, roles: entry.roles })));
  const pageRuleDeclaration = pageRuleEntries.length ? `const pageRules: Array<{ resource: string; action: string; roles: string[] }> = ${JSON.stringify(pageRuleEntries)};\n` : "";
  const pageRuleCheck = pageRuleEntries.length ? `const pageRule = pageRules.find((rule) => rule.resource === resource && rule.action === action); if (pageRule) return pageRule.roles.includes(identity.role ?? "") ? { can: true, reason: "Page access is allowed" } : { can: false, reason: "Page access is restricted" }; ` : "";
  const requiresAuthShell = usesAuth;
  const usesRealtime = Boolean(options.realtime);
  // Realtime always streams over SSE; GraphQL apps additionally get subscription roots.
  const usesGraphqlSubscriptions = usesRealtime && (options.apiClient ?? "rest") === "graphql";
  const errors = validateDatabaseIR(database);
  const menuGroups = options.menuGroups ?? [];
  const groupNames = new Set<string>();
  const assignedResources = new Set<string>();
  const resourceNames = [...database.entities.map((entity) => entity.tableName), ...(database.views ?? []).map((view) => view.name)];
  const actionNames = new Set<string>();
  const iconNames = [...new Set([
    "AppstoreOutlined", "DashboardOutlined", "DatabaseOutlined", "ShoppingOutlined", "TableOutlined", "UserOutlined", "FileTextOutlined", "KeyOutlined",
    ...database.entities.map((entity) => entity.icon).filter((icon): icon is string => Boolean(icon)),
    ...database.entities.flatMap((entity) => entity.fields.map((field) => field.icon)).filter((icon): icon is string => Boolean(icon)),
    ...(database.enums ?? []).flatMap((enumeration) => enumeration.values.map((item) => item.icon)).filter((icon): icon is string => Boolean(icon)),
    ...menuGroups.map((group) => group.icon).filter((icon): icon is string => Boolean(icon)),
    ...(options.charts ?? []).flatMap((chart) => [chart.icon, ...chart.views.map((view) => view.icon)]).filter((icon): icon is string => Boolean(icon)),
  ])].sort();
  for (const icon of iconNames) if (!/^[A-Z][a-zA-Z0-9]*Outlined$/.test(icon)) errors.push(`Invalid Ant Design icon ${icon}`);
  for (const group of menuGroups) {
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(group.name) || groupNames.has(group.name)) errors.push(`Menu group ${group.name}: invalid or duplicate name`);
    groupNames.add(group.name);
    for (const resource of group.resources) {
      if (!resourceNames.includes(resource)) errors.push(`Menu group ${group.name}: unknown resource ${resource}`);
      if (assignedResources.has(resource)) errors.push(`Menu group ${group.name}: duplicate resource ${resource}`);
      assignedResources.add(resource);
    }
  }
  for (const action of options.actions ?? []) {
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(action.name) || actionNames.has(action.name)) errors.push(`Action ${action.name}: invalid or duplicate name`);
    actionNames.add(action.name);
    const entity = database.entities.find((candidate) => candidate.tableName === action.resource || candidate.name === action.resource);
    if (!entity) errors.push(`Action ${action.name}: unknown resource ${action.resource}`);
    if (!action.placements.length || new Set(action.placements).size !== action.placements.length) errors.push(`Action ${action.name}: placements must be unique and non-empty`);
    if (action.target.kind === "dataflow") {
      const target = action.target;
      const flow = options.dataflows?.find((candidate) => candidate.name === target.dataflow);
      if (!flow) errors.push(`Action ${action.name}: unknown dataflow ${target.dataflow}`);
      else if (entity && !flow.context.some((binding) => binding.entity === entity.name)) errors.push(`Action ${action.name}: dataflow ${flow.name} does not load resource ${entity.tableName}`);
    } else if (!/^\/[a-z0-9_-]+(?:\/(?:[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*))*$/.test(action.target.path) || !action.target.path.includes(":id")) {
      errors.push(`Action ${action.name}: navigate path must be a safe absolute route containing :id`);
    }
  }
  for (const group of menuGroups) {
    if (group.parent && !groupNames.has(group.parent)) errors.push(`Menu group ${group.name}: unknown parent ${group.parent}`);
    const seen = new Set([group.name]);
    let parent = group.parent;
    while (parent && !seen.has(parent)) { seen.add(parent); parent = menuGroups.find((candidate) => candidate.name === parent)?.parent; }
    if (parent && seen.has(parent)) errors.push(`Menu group ${group.name}: cyclic parent`);
  }
  if (!database.entities.length) errors.push("V0 dashboard requires at least one entity");
  for (const entity of database.entities) {
    if (!entity.fields.some((field) => field.primaryKey && field.name === "id" && field.type === "UUID")) errors.push(`${entity.name}: V0 dashboard requires a UUID id field`);
    if (!options.readOnly && entity.fields.some((field) => field.type === "Vector" && !field.nullable)) errors.push(`${entity.name}: V0 dashboard cannot edit a required Vector field`);
    for (const field of options.readOnly ? [] : entity.fields) {
      // Generated values are hidden from the create form on purpose: the server fills them.
      // A @default column fills an omitted value the same way.
      const generated = field.defaultValue !== undefined || generatedFieldKind(field, { hasRelation: (database.relations ?? []).some((relation) => relation.fromEntity === entity.name && relation.fromField === field.name) }) !== undefined;
      if (!field.primaryKey && !field.nullable && field.type !== "Vector" && !generated && !(field.formVisible ?? field.visible ?? true)) errors.push(`${entity.name}.${field.name}: required field cannot be hidden from the create form`);
    }
    if (!options.readOnly && !entity.fields.some(editable)) errors.push(`${entity.name}: V0 dashboard requires an editable field`);
    if (!/^[a-z][a-z0-9_-]*$/.test(entity.tableName)) errors.push(`${entity.name}: route path must be lowercase and URL-safe`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const template = renderAppTemplate("web", "web");
  const root = template["web/app/root.tsx"]!;
  const show = template["web/app/routes/show.tsx"]!;
  const hasRelatedResources = (database.relations ?? []).some((relation) => database.entities.some((entity) => entity.name === relation.toEntity));
  // Chart pages: declarations with the same name are the views of one chart;
  // view labels are keyed by kind, distribution labels by enum value.
  const chartEntity = (entityName: string) => database.entities.find((entity) => entity.tableName === entityName || entity.name === entityName);
  const enumValuesFor = (entityName: string, fieldName: string | undefined) => {
    if (!fieldName) return [];
    const field = chartEntity(entityName)?.fields.find((candidate) => candidate.name === fieldName);
    const enumeration = field?.enumName ? database.enums?.find((candidate) => candidate.name === field.enumName) : undefined;
    return (enumeration?.values ?? []).map((value) => ({ value: value.name, label: value.label ?? value.name }));
  };
  const chartLabelsMetadata = (chart: QiyChart, view: QiyChartView) => {
    if (view.kind !== "pie" && view.kind !== "bar") return undefined;
    if (view.labels?.values?.length) {
      return { field: view.labels.field, values: view.labels.values.map((entry) => ({ value: entry.value, label: entry.label, labelKey: qiyModelKeys.chartLabelValue(chart.name, entry.value) })) };
    }
    const field = view.labels?.field ?? view.data.groupBy;
    const values = enumValuesFor(view.data.entity, field).map((entry) => ({ ...entry, labelKey: qiyModelKeys.chartLabelValue(chart.name, entry.value) }));
    return values.length ? { ...(field ? { field } : {}), values } : undefined;
  };
  const localizedCharts = (options.charts ?? []).map((chart) => ({
    name: chart.name,
    title: chart.title ?? chart.name,
    labelKey: qiyModelKeys.chartLabel(chart.name),
    ...(chart.icon ? { icon: chart.icon } : {}),
    views: chart.views.map((view) => {
      const labels = chartLabelsMetadata(chart, view);
      return {
        kind: view.kind,
        label: view.title ?? chart.title ?? chart.name,
        labelKey: qiyModelKeys.chartViewLabel(chart.name, view.kind),
        data: view.data,
        ...(view.color ? { color: view.color } : {}),
        ...(view.legend !== undefined ? { legend: view.legend } : {}),
        ...(labels ? { labels } : {}),
      };
    }),
  }));
  const localizedChartPanels = (options.chartPanels ?? []).map((panel) => ({
    name: panel.name,
    title: panel.title ?? panel.name,
    labelKey: qiyModelKeys.chartLabel(panel.name),
    grid: panel.grid,
    charts: panel.charts.map((chart) => ({ name: chart.name, placements: chart.placements })),
  }));
  // A generated test can only assert a concrete language switch when the model
  // declares translations for the first resource in both built-in locales.
  const firstEntity = database.entities[0];
  const firstResourceKey = firstEntity ? qiyModelKeys.resourceLabel(firstEntity.tableName) : undefined;
  const firstResourceZh = firstResourceKey ? options.messages?.locales["zh-CN"]?.[firstResourceKey] : undefined;
  const firstResourceEn = firstResourceKey ? options.messages?.locales["en-US"]?.[firstResourceKey] : undefined;
  const localeSwitchTest = firstEntity && firstResourceKey && firstResourceZh !== undefined && firstResourceEn !== undefined
    ? `
test("model labels switch between the declared Chinese and English dictionaries", () => {
  const resource = resources[0]!;
  expect(createI18nProvider("zh-CN").translate(${JSON.stringify(firstResourceKey)}, {}, resource.label)).toBe(${JSON.stringify(firstResourceZh)});
  expect(createI18nProvider("en-US").translate(${JSON.stringify(firstResourceKey)}, {}, resource.label)).toBe(${JSON.stringify(firstResourceEn)});
  expect(${JSON.stringify(firstResourceZh)}).not.toBe(${JSON.stringify(firstResourceEn)});
});
`
    : "";
  const distributionEntity = database.entities.find((entity) => entity.fields.some((field) => field.enumName));
  const distributionField = distributionEntity?.fields.find((field) => field.enumName);
  const trendEntity = database.entities.find((entity) => entity.fields.some((field) => field.type === "DateTime"));
  const trendField = trendEntity?.fields.find((field) => field.type === "DateTime");
  // Permission metadata drives command button visibility. `allow permission`
  // references expand to the permission values a principal must hold; an
  // `allow verification` can only be evaluated client-side when it declares no
  // inputs (the server still enforces every verification on the command route).
  const permissionModel = options.permissions && options.permissions.fields.length ? options.permissions : undefined;
  const expandWebPermissionRefs = (references: string[] | undefined): string[] | undefined => {
    if (!references?.length) return undefined;
    return permissionModel ? requiredPermissionValues(permissionModel, references) : references;
  };
  const webVerification = (name: string | undefined): { name: string; expression: QiyPermissionExpressionIR } | undefined => {
    if (!name || !permissionModel) return undefined;
    const verification = permissionModel.verifications.find((candidate) => candidate.name === name);
    if (!verification || verification.inputs.length) return undefined;
    return { name: verification.name, expression: verification.expression };
  };
  const actionDefinitions: GeneratedAction[] = (options.actions ?? []).map((action) => {
    const labelKey = action.labelKey ?? qiyModelKeys.actionLabel(action.name);
    if (action.target.kind === "navigate") {
      return {
        ...action,
        labelKey,
        resource: database.entities.find((entity) => entity.name === action.resource)?.tableName ?? action.resource,
        target: {
          ...action.target,
          ...(action.permission?.length ? { permissions: expandWebPermissionRefs(action.permission) } : {}),
          ...(webVerification(action.verification) ? { verification: webVerification(action.verification) } : {}),
        },
      };
    }
    const target = action.target;
    const flow = options.dataflows!.find((candidate) => candidate.name === target.dataflow)!;
    const entity = database.entities.find((candidate) => candidate.tableName === action.resource || candidate.name === action.resource)!;
    const binding = flow.context.find((candidate) => candidate.entity === entity.name)!;
    const source = binding.id.split(":", 2)[1]!;
    return {
      ...action,
      labelKey,
      resource: entity.tableName,
      target: {
        ...target,
        ...(target.confirm !== undefined && !target.confirmKey ? { confirmKey: qiyModelKeys.actionConfirm(action.name) } : {}),
        url: `/api/v1/commands/${flow.name}${action.batch ? "/batch" : ""}`,
        idempotency: flow.idempotency?.required === true,
        roles: flow.roles ?? roles.writers,
        ...(flow.permission?.length ? { permissions: expandWebPermissionRefs(flow.permission) } : {}),
        ...(webVerification(flow.verification) ? { verification: webVerification(flow.verification) } : {}),
        idInput: source.split(".", 2)[1]!,
        inputs: flow.input.map((input) => ({ name: input.name, type: input.type, required: input.required, comment: input.comment, ...(input.commentKey && { commentKey: input.commentKey }), labelKey: input.commentKey ?? qiyModelKeys.actionInputLabel(action.name, input.name), ...(database.enums?.some((enumeration) => enumeration.name === input.type) ? { options: database.enums.find((enumeration) => enumeration.name === input.type)!.values.map((value) => ({ value: value.name, label: value.label ?? value.name, labelKey: qiyModelKeys.enumValueLabel(input.type, value.name) })) } : {}) })),
      },
    };
  });
  type CommandPolicy = { resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpressionIR } };
  const actionPolicies: CommandPolicy[] = actionDefinitions.flatMap((action) => {
    const base = { resource: action.resource, action: action.name };
    if (action.target.kind === "dataflow") {
      return [{
        ...base,
        roles: action.target.roles,
        ...(action.target.permissions?.length ? { permissions: action.target.permissions } : {}),
        ...(action.target.verification ? { verification: action.target.verification } : {}),
      }];
    }
    const permissions = expandWebPermissionRefs(action.permission);
    const verification = webVerification(action.verification);
    if (!action.roles?.length && !permissions?.length && !verification) return [];
    return [{ ...base, roles: action.roles ?? [], ...(permissions?.length ? { permissions } : {}), ...(verification ? { verification } : {}) }];
  });
  const commandVerifications = Object.fromEntries(actionPolicies.filter((policy) => policy.verification).map((policy) => [policy.verification!.name, policy.verification!.expression]));
  // Model-derived permission visibility cases: the generated access control test
  // asserts permission/verification command policies against effective identity
  // metadata, with expectations computed by tools/permissions.ts.
  const declaredWebPermissionValues = permissionModel ? requiredPermissionValues(permissionModel, permissionModel.fields.map((field) => field.name)) : [];
  const allWebGroups = permissionModel?.groups.map((group) => group.name) ?? [];
  const webPermissionPolicies = actionPolicies.filter((policy) => policy.permissions?.length || policy.verification);
  const webPermissionCases = webPermissionPolicies.flatMap((policy) => {
    const variants: Array<{ role: string; permissions?: string[]; groups?: string[]; expected: boolean }> = [];
    if (policy.permissions?.length) {
      variants.push({ role: roles.least, permissions: policy.permissions, groups: [], expected: true });
      variants.push({ role: roles.least, permissions: [], groups: [], expected: false });
    }
    if (policy.verification) {
      const expression = policy.verification.expression;
      const evaluate = (identity: { role: string; permissions: string[]; groups: string[] }) => evaluatePermissionExpression(expression, { self: { permissions: identity.permissions, groups: identity.groups, role: identity.role }, input: {} }).allowed;
      const admin = { role: roles.admin, permissions: declaredWebPermissionValues, groups: allWebGroups };
      const viewer = { role: roles.least, permissions: [], groups: [] };
      variants.push({ ...admin, expected: evaluate(admin) });
      variants.push({ ...viewer, expected: evaluate(viewer) });
    }
    return variants.map((variant) => ({ policy, variant }));
  });

  /**
   * Client-side command permission check. The server remains authoritative: this
   * only hides buttons whose command would be denied. `allow permission` commands
   * use the effective `permissions` from `/auth/me`; when the server exposes no
   * permission metadata the generated access control falls back to the legacy
   * role allow list. Input-free `allow verification` rules are evaluated with the
   * same operator semantics as the server.
   */
  const usesCommandPermissions = actionPolicies.some((policy) => policy.permissions?.length || policy.verification);
  const commandPolicyTypes = `type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };
type QiyCommandPolicy = { resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } };
`;
  const commandPolicyFunctions = usesCommandPermissions
    ? `function permissionOperandValues(operand: QiyPermissionOperand, identity: QiyIdentity): string[] {
  if (operand.kind === "self") {
    if (operand.set === "role") return [identity.role ?? ""];
    return [...(operand.set === "permissions" ? identity.permissions ?? [] : identity.groups ?? [])];
  }
  if (operand.kind === "literal") return [operand.value];
  return [];
}
function comparePermissionKeys(operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals", left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference = [...leftSet].filter((entry) => !rightSet.has(entry));
  if (operator === "all-in") return difference.length === 0;
  if (operator === "some-in") return [...leftSet].some((entry) => rightSet.has(entry));
  if (operator === "not-all-in") return difference.length > 0;
  if (operator === "not-some-in") return [...leftSet].every((entry) => !rightSet.has(entry));
  if (operator === "equals") return difference.length === 0 && rightSet.size === leftSet.size;
  return !(difference.length === 0 && rightSet.size === leftSet.size);
}
function evaluatePermissionExpression(expression: QiyPermissionExpression, identity: QiyIdentity): boolean {
  if (expression.kind === "comparison") return comparePermissionKeys(expression.operator, permissionOperandValues(expression.left, identity), permissionOperandValues(expression.right, identity));
  if (expression.kind === "not") return !evaluatePermissionExpression(expression.expression, identity);
  if (expression.kind === "and") return expression.children.every((child) => evaluatePermissionExpression(child, identity));
  return expression.children.some((child) => evaluatePermissionExpression(child, identity));
}
function evaluateCommandPermission(command: QiyCommandPolicy, identity: QiyIdentity): { can: boolean; reason: string } | undefined {
  if (command.verification) {
    const expression = commandVerifications[command.verification.name];
    if (expression) {
      const allowed = evaluatePermissionExpression(expression, identity);
      return allowed ? { can: true, reason: "Permission verification " + command.verification.name + " satisfied" } : { can: false, reason: "Permission verification " + command.verification.name + " denied this command" };
    }
  }
  if (command.permissions?.length) {
    if (!Array.isArray(identity.permissions)) return undefined;
    const missing = command.permissions.filter((permission) => !identity.permissions!.includes(permission));
    return missing.length ? { can: false, reason: "Missing permission: " + missing.join(", ") } : { can: true, reason: "Permission granted" };
  }
  return undefined;
}
`
    : "";
  const commandPermissionEvaluation = usesCommandPermissions
    ? `const permissionVerdict = evaluateCommandPermission(command, identity); if (permissionVerdict) return permissionVerdict; `
    : "";
  const autoGeneratedResource = database.entities.find((entity) => generatedFieldsOf(entity, database.relations ?? []).length > 0);
  const autoGeneratedFields = autoGeneratedResource
    ? generatedFieldsOf(autoGeneratedResource, database.relations ?? []).map((generated) => ({
      name: generated.field.name,
      listVisible: generated.field.listVisible ?? generated.field.visible ?? !generated.field.primaryKey,
      showVisible: generated.field.showVisible ?? generated.field.visible ?? !generated.field.primaryKey,
    }))
    : [];
  const generatedFieldsTest = autoGeneratedResource ? `
test("hides generated fields on create, keeps them visible on edit and shows the hint", () => {
  const resource = resources.find((item) => item.name === ${JSON.stringify(autoGeneratedResource.tableName)})!;
  const generated: Array<{ name: string; listVisible: boolean; showVisible: boolean }> = ${JSON.stringify(autoGeneratedFields)};
  expect(generated.length).toBeGreaterThan(0);
  const create = createFormFields(resource).map((field) => field.name);
  const edit = editFormFields(resource).map((field) => field.name);
  const visible = resource.fields.filter((field) => field.listVisible).map((field) => field.name);
  expect(generatedFormFields(resource).map((field) => field.name).sort()).toEqual(generated.map((field) => field.name).sort());
  for (const expected of generated) {
    const field = resource.fields.find((item) => item.name === expected.name)!;
    expect(field.autoGenerated).toBe(true);
    expect(create).not.toContain(expected.name);
    expect(edit).toContain(expected.name);
    expect(field.showVisible).toBe(expected.showVisible);
    expect(visible.includes(expected.name)).toBe(expected.listVisible);
  }
});

test("translates the auto-generated hint in both built-in locales", () => {
  const zh = createI18nProvider("zh-CN").translate("qiy.autoGenerated");
  const en = createI18nProvider("en-US").translate("qiy.autoGenerated");
  expect(zh).toBeTruthy();
  expect(en).toBeTruthy();
  expect(zh).not.toBe(en);
});
` : "";
  const generated: Record<string, string> = {
    ...template,
    "web/app/ui/theme-config.ts": `export const qiyUiConfig = ${JSON.stringify(ui, null, 2)} as const;\n`,
    "web/app/root.tsx": root
      .replace("__QIY_AUTH_IMPORT__", usesAuth ? (options.auth ? 'import { qiyAccessControlProvider, qiyAuthProvider } from "./auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";' : 'import { qiyIntegrationAuthProvider } from "./host/auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";') : "")
      .replace("__QIY_AUTH_PROPS__", usesAuth ? (options.auth ? "authProvider={qiyAuthProvider} accessControlProvider={qiyAccessControlProvider}" : "authProvider={qiyIntegrationAuthProvider}") : "")
      .replace("__QIY_AUTH_LOCATION__", requiresAuthShell ? 'const location = useLocation(); // legacy login check: location.pathname === "/auth/login"' : "")
      .replace("__QIY_LAYOUT_START__", requiresAuthShell ? '{location.pathname.startsWith("/auth/") || location.pathname.startsWith("/oauth/") ? <Outlet /> : <Authenticated key="protected" fallback={<Navigate to="/auth/login" replace />}> ' : "")
      .replace("__QIY_LAYOUT_END__", requiresAuthShell ? "</Authenticated>}" : ""),
    "web/app/routes/show.tsx": show
      .replace("__QIY_SHOW_IMPORTS__", [hasRelatedResources ? 'import { RelatedRecords } from "../components/related-records";' : "", actionDefinitions.length ? 'import { BusinessActions } from "../components/business-actions";' : ""].filter(Boolean).join("\n"))
      .replace("__QIY_SHOW_EXTRAS__", [hasRelatedResources ? '{result && id && (resource.relatedResources ?? []).map((relation) => <RelatedRecords key={relation.resource + relation.field} relation={relation} recordId={id} />)}' : "", actionDefinitions.length ? '{id && result && <BusinessActions resource={resource.name} placement="show" record={result} />}' : ""].join("")),
    ...(actionDefinitions.length ? {
      "web/app/actions.ts": `type QiyActionCondition = { field: string; operator: "==" | "!="; value: string } | { field: string; operator: "in"; values: string[] };
type QiyActionBase = { name: string; resource: string; placements: Array<"list" | "show">; batch?: boolean; label: string; labelKey?: string; roles?: string[]; condition?: QiyActionCondition };
type QiyVerificationRule = { name: string; expression: unknown };
export type QiyActionDefinition = QiyActionBase & ({ target: { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string; permissions?: string[]; verification?: QiyVerificationRule } } | { target: { kind: "dataflow"; dataflow: string; roles: string[]; permissions?: string[]; verification?: QiyVerificationRule; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; labelKey: string; options?: Array<{ value: string; label: string; labelKey: string }> }> } });
export const qiyActions: QiyActionDefinition[] = ${JSON.stringify(actionDefinitions.map(({ permission: _permission, verification: _verification, ...action }) => action), null, 2)};
export function actionMatchesRecord(action: QiyActionDefinition, record: Record<string, unknown>) { if (!action.condition) return true; if (!Object.prototype.hasOwnProperty.call(record, action.condition.field) || record[action.condition.field] == null) return false; const value = record[action.condition.field]; if (action.condition.operator === "in") return action.condition.values.includes(String(value)); const matches = value === action.condition.value; return action.condition.operator === "==" ? matches : !matches; }
export function actionsFor(resource: string, placement: "list" | "show", record: Record<string, unknown>) { return qiyActions.filter((action) => !action.batch && action.resource === resource && action.placements.includes(placement) && actionMatchesRecord(action, record)); }
export function batchActionsFor(resource: string) { return qiyActions.filter((action) => action.batch && action.resource === resource && action.placements.includes("list") && action.target.kind === "dataflow"); }
export function hasBatchActions(resource: string) { return batchActionsFor(resource).length > 0; }
`,
      "web/app/components/business-actions.tsx": `import { CanAccess, useCustomMutation, useInvalidate, useNotification, useTranslation } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { actionsFor, batchActionsFor, type QiyActionDefinition } from "../actions";

function CommandAction({ action, resource, recordId }: { action: QiyActionDefinition; resource: string; recordId: string }) {
  const { translate } = useTranslation();
  const { open: notify } = useNotification();
  const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient();
  const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required);
  const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label;
  const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => {
    const body = Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]));
    const payload = JSON.stringify(body);
    if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() };
    try {
      await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, ...(target.idempotency ? { meta: { idempotencyKey: pendingRequest.current.key } } : {}) });
      pendingRequest.current = null;
      setOpen(false); form.resetFields(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel });
      await invalidate({ resource, id: recordId, invalidates: ["detail", "list"] });
      await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") });
    } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  const button = <Button type="link" loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel}</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ id: recordId }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={translate(field.labelKey, {}, field.comment ?? field.name)} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options.map((option) => ({ value: option.value, label: translate(option.labelKey, {}, option.label) }))} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

function BatchCommandAction({ action, resource, recordIds, onComplete }: { action: QiyActionDefinition; resource: string; recordIds: string[]; onComplete(): void }) {
  const { translate } = useTranslation(); const { open: notify } = useNotification(); const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient(); const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required); const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label; const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => { const items = recordIds.map((recordId) => Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]))); const body = { items }; const payload = JSON.stringify(body); if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() }; try { await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, meta: { idempotencyKey: pendingRequest.current.key } }); pendingRequest.current = null; setOpen(false); form.resetFields(); onComplete(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel }); await invalidate({ resource, invalidates: ["list"] }); await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") }); } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); } };
  const button = <Button loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel} ({recordIds.length})</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ ids: recordIds }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={translate(field.labelKey, {}, field.comment ?? field.name)} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options.map((option) => ({ value: option.value, label: translate(option.labelKey, {}, option.label) }))} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

export function BusinessActions({ resource, placement, record }: { resource: string; placement: "list" | "show"; record: Record<string, unknown> }) { const { translate } = useTranslation(); const recordId = String(record.id); return <Space wrap>{actionsFor(resource, placement, record).map((action) => action.target.kind === "navigate" ? <CanAccess key={action.name} resource={resource} action={action.name} params={{ id: recordId }}><Link to={action.target.path.replace(":id", encodeURIComponent(recordId))}><Button type="link">{action.labelKey ? translate(action.labelKey, {}, action.label) : action.label}</Button></Link></CanAccess> : <CommandAction key={action.name} action={action} resource={resource} recordId={recordId} />)}</Space>; }
export function BatchBusinessActions({ resource, recordIds, onComplete }: { resource: string; recordIds: string[]; onComplete(): void }) { if (!recordIds.length) return null; return <Space wrap>{batchActionsFor(resource).map((action) => <BatchCommandAction key={action.name} action={action} resource={resource} recordIds={recordIds} onComplete={onComplete} />)}</Space>; }
`,
    } : {}),
    "web/app/icons.tsx": `import { ${iconNames.join(", ")} } from "@ant-design/icons";
export const qiyIcons = { ${iconNames.join(", ")} };
`,
    "web/app/data-provider.ts": renderAppTemplate("web", "web")["web/app/data-provider.ts"]!
      .replace('import type { DataProvider } from "@refinedev/core";', 'import type { DataProvider } from "@refinedev/core";\nimport { qiyApiError } from "./api-error";')
      .replace('Object.assign(new Error(typeof data?.error === "string" ? data.error : `API error ${response.status}`), { statusCode: response.status })', 'qiyApiError(data, response.status)')
      .replace('Object.assign(new Error(typeof content?.error === "string" ? content.error : `API error ${response.status}`), { statusCode: response.status })', 'qiyApiError(content, response.status)')
      .replace('      if (Object.keys(fieldFilters).length > 0) params.set("filters", JSON.stringify(fieldFilters));', '      const encodeFilters = (items: readonly any[]): unknown[] => items.flatMap<unknown>((filter) => { if (!("field" in filter)) return filter.operator === "and" || filter.operator === "or" ? [{ operator: filter.operator, filters: encodeFilters(Array.isArray(filter.value) ? filter.value : []) }] : []; if (filter.field === "q" || filter.field === "__search" || !("value" in filter)) return []; return [{ field: String(filter.field), operator: String(filter.operator ?? "eq"), value: Array.isArray(filter.value) ? filter.value.map(String).join(",") : String(filter.value) }]; });\n      const encodedFilters = encodeFilters(filters ?? []);\n      if (encodedFilters.length > 0) params.set("filters", JSON.stringify(encodedFilters));\n      else if (Object.keys(fieldFilters).length > 0) params.set("filters", JSON.stringify(fieldFilters));')
      .replace('        if (!("field" in filter) || filter.field === "q" || filter.field === "__search" || !("value" in filter) || filter.operator !== "eq") return [];\n        return [{ field: String(filter.field), value: String(filter.value) }];', '        if (!("field" in filter) || filter.field === "q" || filter.field === "__search" || !("value" in filter)) return [];\n        return filter.operator === "eq" ? [{ field: String(filter.field), value: String(filter.value) }] : [{ field: String(filter.field), operator: String(filter.operator), value: String(filter.value) }];')
      .replaceAll("__QIY_DEFAULT_API_TRANSPORT__", options.apiClient ?? "rest")
      .replace("const dataflowCommands = new Set<string>([]);", `const dataflowCommands = new Set<string>(${JSON.stringify([...(options.dataflows ?? []).map((flow) => `/api/v1/commands/${flow.name}`), ...actionDefinitions.flatMap((action) => action.batch && action.target.kind === "dataflow" ? [action.target.url] : [])])});`),
    "web/app/api-error.ts": `import { defaultMessageLocale, projectMessage } from "./messages";
export function qiyApiError(payload: unknown, statusCode: number, locale = typeof document === "undefined" ? defaultMessageLocale : document.documentElement.lang) {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const errorKey = typeof body.errorKey === "string" ? body.errorKey : undefined;
  const fallback = typeof body.error === "string" ? body.error : "API error " + statusCode;
  const message = errorKey ? projectMessage(locale, errorKey) ?? fallback : fallback;
  return Object.assign(new Error(message), { statusCode, ...(errorKey ? { errorKey } : {}) });
}
`,
    "web/app/charts.ts": `export type ChartViewKind = "const" | "pie" | "bar" | "line" | "area" | "scatter" | "stacked" | "table";
export type ChartAggregate = "sum" | "avg" | "min" | "max";
export type ChartDataOperation = "count" | "sum" | "avg" | "min" | "max" | "trend" | "list";
export interface ChartDataDefinition { operation: ChartDataOperation; entity: string; field?: string; groupBy?: string; days?: number; columns?: string[]; }
export interface ChartLabelValue { value: string; label: string; labelKey: string; }
export interface ChartLabelsDefinition { field?: string; values: ChartLabelValue[]; }
export interface ChartViewDefinition { kind: ChartViewKind; label: string; labelKey: string; data: ChartDataDefinition; labels?: ChartLabelsDefinition; color?: string; legend?: boolean; }
export interface ChartDefinition { name: string; title: string; labelKey: string; icon?: string; views: ChartViewDefinition[]; }
export type ChartVariant = "larger" | "xl" | "lg" | "large" | "medium" | "md" | "small" | "sm" | "xs";
export interface ChartPlacement { variant: ChartVariant; x: number; y: number; w: number; h: number; }
export interface ChartPanelChart { name: string; placements: ChartPlacement[]; }
export interface ChartPanelDefinition { name: string; title: string; labelKey: string; grid: { columns: number; rows: number }; charts: ChartPanelChart[]; }
export type ChartViewportCategory = "larger" | "medium" | "small";
export const chartViewKinds: ChartViewKind[] = ["const", "pie", "bar", "line", "area", "scatter", "stacked", "table"];
export const chartVariantNames: ChartVariant[] = ${JSON.stringify([...qiyChartVariants])};
export const chartVariantBreakpoint: Record<ChartVariant, ChartViewportCategory> = { larger: "larger", xl: "larger", lg: "larger", large: "larger", medium: "medium", md: "medium", small: "small", sm: "small", xs: "small" };
export const chartViewportBreakpoints = { larger: 1200, medium: 768 } as const;
export function chartViewportCategory(width: number): ChartViewportCategory { return width >= chartViewportBreakpoints.larger ? "larger" : width >= chartViewportBreakpoints.medium ? "medium" : "small"; }
export function chartViewKindLabelKey(kind: ChartViewKind): string { return "qiy.chartViewKind." + kind; }
/** Largest declared placement that fits the viewport category, falling back to the smallest declared one. */
export function selectChartPlacement(placements: ChartPlacement[], category: ChartViewportCategory): ChartPlacement | undefined {
  const buckets: ChartViewportCategory[] = ["larger", "medium", "small"];
  const byBucket = new Map<ChartViewportCategory, ChartPlacement>();
  for (const placement of placements) {
    const bucket = chartVariantBreakpoint[placement.variant];
    if (bucket && !byBucket.has(bucket)) byBucket.set(bucket, placement);
  }
  const start = buckets.indexOf(category);
  for (const bucket of buckets.slice(start)) { const found = byBucket.get(bucket); if (found) return found; }
  for (const bucket of buckets.slice(0, start).reverse()) { const found = byBucket.get(bucket); if (found) return found; }
  return placements[0];
}
export function defaultChartView(chart: ChartDefinition): ChartViewDefinition | undefined { return chart.views[0]; }
export const chartPanelStorageKey = "qiy.charts.panel";
type ChartPanelStorage = Pick<Storage, "getItem" | "setItem">;
function chartPanelStorage(): ChartPanelStorage | undefined { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } }
export function readStoredChartPanel(storage: ChartPanelStorage | undefined = chartPanelStorage()): string | undefined { try { return storage?.getItem(chartPanelStorageKey) ?? undefined; } catch { return undefined; } }
export function storeChartPanel(name: string, storage: ChartPanelStorage | undefined = chartPanelStorage()): void { try { storage?.setItem(chartPanelStorageKey, name); } catch { /* quota or private mode */ } }
export function resolveChartPanel(panels: ChartPanelDefinition[], stored: string | undefined): ChartPanelDefinition | undefined { return panels.find((panel) => panel.name === stored) ?? panels[0]; }
export const charts: ChartDefinition[] = ${JSON.stringify(localizedCharts, null, 2)};
export const chartPanels: ChartPanelDefinition[] = ${JSON.stringify(localizedChartPanels, null, 2)};
export const hasChartDashboard = charts.length > 0;
export function findChart(name: string): ChartDefinition | undefined { return charts.find((chart) => chart.name === name); }
`,
    ...(options.auth ? {
      "web/app/auth.ts": `import type { AccessControlProvider, AuthProvider } from "@refinedev/core";
${usesOidcAuth ? 'import { beginOidcLogin, beginOidcLogout, clearOidcSession, oidcSession, oidcSessionSkewMs } from "./auth/oidc-client";' : ""}${hybridAuth ? 'import { beginProviderLogin, clearSession, fetchAuthProviders } from "./auth/oidc-multi";' : ""}

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string; permissions?: string[]; groups?: string[] };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
/** With OIDC the stored expiry decides validity so an expired token never looks authenticated. */
const sessionUsable = () => typeof window === "undefined" ? false : ${usesOidcAuth ? `!oidcSession({ skewMs: oidcSessionSkewMs }).expired` : "Boolean(token())"};
/**
 * Identity lookups are shared for the lifetime of an access token. Refine calls
 * getIdentity and the access-control can hook many times per navigation; without
 * this cache every call issued another GET /api/v1/auth/me. Concurrent callers share
 * one in-flight request and the successful result is reused for a minute.
 */
const identityCacheTtlMs = 60_000;
let identityCache: { token: string; value: QiyIdentity | null; at: number } | undefined;
let identityInflight: { token: string; promise: Promise<QiyIdentity | null> } | undefined;
export function clearIdentityCache(): void { identityCache = undefined; identityInflight = undefined; }
async function loadIdentity(): Promise<QiyIdentity | null> {
  const accessToken = token();
  if (!accessToken) return null;
  if (identityCache && identityCache.token === accessToken && Date.now() - identityCache.at < identityCacheTtlMs) return identityCache.value;
  if (identityInflight && identityInflight.token === accessToken) return identityInflight.promise;
  const promise = (async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { headers: { Authorization: "Bearer " + accessToken } });
      if (!response.ok) return null;
      return await response.json() as QiyIdentity;
    } catch { return null; }
  })().then((value) => {
    identityCache = { token: accessToken, value, at: Date.now() };
    return value;
  }).finally(() => { if (identityInflight?.token === accessToken) identityInflight = undefined; });
  identityInflight = { token: accessToken, promise };
  return promise;
}
export const qiyAuthProvider: AuthProvider = {
  login: async ({ token: nextToken, username, email, password, identifier, challengeToken, code${hybridAuth ? ", providerName" : ""} }: { token?: string; username?: string; email?: string; password?: string; identifier?: string; challengeToken?: string; code?: string${hybridAuth ? "; providerName?: string" : ""} }) => {
    const loginName = username ?? email;
    ${hybridAuth ? `if (providerName) {
      const providers = await fetchAuthProviders();
      const selected = providers.find((candidate) => candidate.id === providerName);
      if (!selected) return { success: false, error: { name: "ProviderUnavailable", message: "That identity provider is not configured on the server" } };
      await beginProviderLogin(selected);
      return { success: true };
    }` : ""}
    ${hasLocalAuth ? `
    if (loginName && password) {
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginName, password }) });
      if (!response.ok) return { success: false, error: { name: "LoginFailed", message: (await response.json().catch(() => null) as { error?: string } | null)?.error ?? "Invalid username or password" } };
      const result = await response.json() as { accessToken?: string };
      if (!result.accessToken) return { success: false, error: { name: "LoginFailed", message: "Login response did not contain an access token" } };
      window.localStorage.setItem(tokenKey, result.accessToken);
      return { success: true, redirectTo: "/" };
    }` : ""}
    ${usesOtpAuth ? `if (identifier && challengeToken && code) { const response = await fetch("/api/v1/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, challengeToken, code }) }); const result = await response.json().catch(() => null) as { accessToken?: string; error?: string } | null; if (!response.ok || !result?.accessToken) return { success: false, error: { name: "OtpVerificationFailed", message: result?.error ?? "Invalid or expired one-time password" } }; window.localStorage.setItem(tokenKey, result.accessToken); return { success: true, redirectTo: "/" }; }` : ""}
    ${usesOidcAuth ? 'await beginOidcLogin(); return { success: true };' : 'void nextToken;'}
    return { success: false, error: { name: "CredentialsRequired", message: ${JSON.stringify(usesOtpAuth ? "Identifier, challenge token and one-time password are required" : hasLocalAuth ? "Username and password are required" : "Identity provider login could not start")} } };
  },
  logout: async () => { clearIdentityCache(); ${hybridAuth ? "clearSession();" : usesOidcAuth ? "clearOidcSession();" : 'window.localStorage.removeItem(tokenKey);'} ${usesOidcAuth ? "beginOidcLogout();" : ""} return { success: true, redirectTo: "/auth/login" }; },
  check: async () => sessionUsable() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => loadIdentity(),
  getPermissions: async () => { const identity = await loadIdentity(); return identity?.role ?? null; },
  onError: async (error) => { clearIdentityCache(); return error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {}; },
};
const commandPolicies: Array<{ resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } }> = ${JSON.stringify(actionPolicies)};
const commandVerifications: Record<string, QiyPermissionExpression> = ${JSON.stringify(commandVerifications)};
${commandPolicyTypes}${commandPolicyFunctions}${resourcePolicyDeclaration}${pageRuleDeclaration}const roleAccess: Record<string, "full" | "write" | "read"> = ${JSON.stringify(roleAccess)};
export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; const access: string | undefined = roleAccess[identity.role ?? ""]; ${resourcePolicyCheck}${pageRuleCheck}const command = commandPolicies.find((policy) => policy.resource === resource && policy.action === action); if (command) { ${commandPermissionEvaluation}return { can: command.roles.includes(identity.role ?? ""), reason: "Command execution is restricted" }; } if (access === "full") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = access === "write" || (access === "read" && (action === "list" || action === "show")); return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }
/** Cached identity for non-hook callers (route modules must not use auth hooks). */
export async function fetchCurrentIdentity(): Promise<QiyIdentity | null> { return loadIdentity(); }
`,
      "web/app/routes/login.tsx": hybridAuth
        ? `import { AuthPage } from "@refinedev/antd";
import { useEffect, useState } from "react";
import { fetchAuthProviders } from "../auth/oidc-multi";

/**
 * One login page for password accounts and every OAuth provider configured on
 * the server. AuthPage renders the credentials form; the providers prop adds one
 * button per provider (the login mutation then starts the PKCE redirect).
 */
export default function Login() {
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([]);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) setProviders(list.map((provider) => ({ name: provider.id, label: provider.label }))); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <AuthPage type="login" title="Qiy Admin" providers={providers} registerLink={false} forgotPasswordLink={false} rememberMe={false} formProps={{ layout: "vertical" }} />;
}
`
        : options.auth?.provider === "local"
        ? `import { AuthPage } from "@refinedev/antd";
export default function Login() { return <AuthPage type="login" title="Qiy Admin" registerLink={false} forgotPasswordLink={false} formProps={{ layout: "vertical" }} />; }
`
        : usesOtpAuth
          ? `import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { useState } from "react";
import { useLogin, useTranslation } from "@refinedev/core";
export default function Login() { const { translate } = useTranslation(); const [identifier, setIdentifier] = useState(""); const [challengeToken, setChallengeToken] = useState(""); const [code, setCode] = useState(""); const [requesting, setRequesting] = useState(false); const [requestError, setRequestError] = useState<string>(); const { mutate, isPending, error } = useLogin(); const requestCode = async () => { setRequesting(true); setRequestError(undefined); try { const response = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier }) }); const result = await response.json().catch(() => null) as { challengeToken?: string; error?: string; devCode?: string } | null; if (!response.ok || !result?.challengeToken) throw new Error(result?.error ?? translate("qiy.otpSendFailed", {}, "Could not send one-time password")); setChallengeToken(result.challengeToken); if (result.devCode) setCode(result.devCode); } catch (reason) { setRequestError(reason instanceof Error ? reason.message : String(reason)); } finally { setRequesting(false); } }; return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title={translate("qiy.otpTitle", {}, "Qiy Admin sign in")} style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}><Typography.Paragraph type="secondary">{translate("qiy.otpHint", {}, "Enter the email, phone or model identifier configured for this account to receive a one-time password.")}</Typography.Paragraph><Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={translate("qiy.otpIdentifier", {}, "Sign-in identifier")} disabled={Boolean(challengeToken)} />{challengeToken ? <><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder={translate("qiy.otpCode", {}, "One-time password")} /><Button type="primary" loading={isPending} block onClick={() => mutate({ identifier, challengeToken, code })}>{translate("qiy.otpVerify", {}, "Verify and sign in")}</Button><Button block onClick={() => { setChallengeToken(""); setCode(""); }}>{translate("qiy.otpResend", {}, "Send again")}</Button></> : <Button type="primary" loading={requesting} block onClick={() => void requestCode()}>{translate("qiy.otpSend", {}, "Send code")}</Button>}{(requestError || error) && <Alert type="error" message={requestError ?? error?.message ?? String(error)} />}</Space></Card></div>; }
`
        : `import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useLogin, useTranslation } from "@refinedev/core";
import { beginOidcSilentRenew, consumeSilentAttempt, oidcSession, oidcSessionSkewMs, oidcProviderLabel } from "../auth/oidc-client";
export default function Login() { const { translate } = useTranslation(); const { mutate, isPending, error } = useLogin(); const [renewing, setRenewing] = useState(false); const [renewError, setRenewError] = useState<string>(); useEffect(() => { if (!oidcSession({ skewMs: oidcSessionSkewMs }).expired) return; if (!consumeSilentAttempt()) return; setRenewing(true); void beginOidcSilentRenew("/").catch((reason: unknown) => { setRenewError(reason instanceof Error ? reason.message : String(reason)); setRenewing(false); }); }, []); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title={translate("qiy.oidcTitle", {}, "Qiy Admin sign in")} style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}><Typography.Paragraph type="secondary">{translate("qiy.oidcHint", { provider: ${JSON.stringify(authProviderLabel)} })}</Typography.Paragraph>{renewing ? <><Spin /><Typography.Paragraph>{translate("qiy.oidcRenewing", {}, "Trying silent renewal…")}</Typography.Paragraph></> : <Button type="primary" loading={isPending} block onClick={() => mutate({})}>{translate("qiy.oidcSignIn", { provider: ${JSON.stringify(authProviderLabel)} })}</Button>}{(renewError || error) && <Alert type="error" message={renewError ?? error?.message ?? String(error)} />}</Space></Card></div>; }
`,
      ...(usesOidcAuth ? {
        "web/app/auth/oidc-client.ts": `export interface OidcClientConfig { authorizationUrl: string; tokenUrl: string; clientId: string; scope: string; redirectUri: string; logoutUrl?: string; }
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type EnvLike = Record<string, string | undefined>;
const accessTokenKey = "qiy.access_token";
const idTokenKey = "qiy.id_token";
const expiresAtKey = "qiy.expires_at";
const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const silentAttemptKey = "qiy.oidc.silent_attempt";
export const oidcProviderLabel = ${JSON.stringify(authProviderLabel)};
export const oidcSessionSkewMs = 60_000;

function envSource(): EnvLike { return import.meta.env as EnvLike; }
function required(env: EnvLike, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error("Missing frontend environment variable " + name); return value; }
export function readOidcClientConfig(env: EnvLike = envSource(), origin = window.location.origin): OidcClientConfig {
  return {
    authorizationUrl: required(env, "VITE_QIY_AUTHORIZATION_URL"),
    tokenUrl: required(env, "VITE_QIY_TOKEN_URL"),
    clientId: required(env, "VITE_QIY_CLIENT_ID"),
    scope: env.VITE_QIY_AUTH_SCOPE?.trim() || "openid profile email",
    redirectUri: env.VITE_QIY_REDIRECT_URI?.trim() || origin + "/auth/callback",
    ...(env.VITE_QIY_LOGOUT_URL?.trim() ? { logoutUrl: env.VITE_QIY_LOGOUT_URL.trim() } : {}),
  };
}
function randomValue(): string { const bytes = crypto.getRandomValues(new Uint8Array(32)); return base64Url(bytes); }
function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\\+/g, "-").replace(/\\\//g, "_").replace(/=+$/, ""); }
export async function createPkceChallenge(verifier: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }
export async function buildAuthorizationUrl(config: OidcClientConfig, verifier: string, state: string, prompt?: "none"): Promise<string> { const url = new URL(config.authorizationUrl); url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", config.clientId); url.searchParams.set("redirect_uri", config.redirectUri); url.searchParams.set("scope", config.scope); url.searchParams.set("state", state); url.searchParams.set("code_challenge", await createPkceChallenge(verifier)); url.searchParams.set("code_challenge_method", "S256"); if (prompt) url.searchParams.set("prompt", prompt); return url.toString(); }
export async function beginOidcLogin(returnTo = window.location.pathname + window.location.search): Promise<void> { const config = readOidcClientConfig(); const verifier = randomValue(); const state = randomValue(); window.sessionStorage.setItem(verifierKey, verifier); window.sessionStorage.setItem(stateKey, state); window.sessionStorage.setItem(returnToKey, returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); window.sessionStorage.removeItem(silentAttemptKey); window.location.assign(await buildAuthorizationUrl(config, verifier, state)); }
export interface OidcSession { token?: string; expiresAt?: number; expired: boolean; }
/**
 * Reads the stored session and reports whether the access token is no longer
 * usable. When the provider did not return expires_in the expiry is unknown and
 * the token is treated as usable, which keeps behaviour unchanged for such IdPs.
 */
export function oidcSession(options: { storage?: StorageLike; now?: number; skewMs?: number } = {}): OidcSession { const storage = options.storage ?? window.localStorage; const now = options.now ?? Date.now(); const skew = options.skewMs ?? 0; const token = storage.getItem(accessTokenKey) ?? undefined; const raw = storage.getItem(expiresAtKey); const expiresAt = raw === null ? undefined : Number(raw); const known = expiresAt !== undefined && Number.isFinite(expiresAt); return { ...(token ? { token } : {}), ...(known ? { expiresAt } : {}), expired: !token || (known && expiresAt - skew <= now) }; }
export function clearOidcSession(storage: StorageLike = window.localStorage, session: StorageLike = window.sessionStorage): void { storage.removeItem(accessTokenKey); storage.removeItem(idTokenKey); storage.removeItem(expiresAtKey); session.removeItem(silentAttemptKey); }
/** True once per redirect cycle, so a failed silent renewal cannot loop. */
export function consumeSilentAttempt(session: StorageLike = window.sessionStorage): boolean { if (session.getItem(silentAttemptKey) === "1") return false; session.setItem(silentAttemptKey, "1"); return true; }
/**
 * Renews the session through the identity provider without user interaction.
 * This relies on the provider session cookie, so no refresh token is kept in
 * browser storage; a refresh-token or refresh-cookie design belongs in a
 * backend-for-frontend.
 */
export async function beginOidcSilentRenew(returnTo = "/", config?: OidcClientConfig): Promise<void> { const effective = config ?? readOidcClientConfig(); const verifier = randomValue(); const state = randomValue(); window.sessionStorage.setItem(verifierKey, verifier); window.sessionStorage.setItem(stateKey, state); window.sessionStorage.setItem(returnToKey, returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); window.location.assign(await buildAuthorizationUrl(effective, verifier, state, "none")); }
export function isSilentRenewFailure(message: string | undefined): boolean { return Boolean(message && /login_required|interaction_required|consent_required|account_selection_required/i.test(message)); }
export async function completeOidcLogin(callbackUrl: string, storage: StorageLike = window.sessionStorage, localStorage: StorageLike = window.localStorage, fetcher: typeof fetch = fetch, config = readOidcClientConfig()): Promise<string> { const url = new URL(callbackUrl); const providerError = url.searchParams.get("error"); if (providerError) throw new Error(url.searchParams.get("error_description") || providerError); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const expectedState = storage.getItem(stateKey); const verifier = storage.getItem(verifierKey); if (!code || !state || !expectedState || state !== expectedState || !verifier) { storage.removeItem(verifierKey); storage.removeItem(stateKey); throw new Error("Invalid or expired OAuth state"); } const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, redirect_uri: config.redirectUri, code_verifier: verifier }); const response = await fetcher(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); const result = await response.json().catch(() => null) as { access_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string } | null; if (!response.ok || !result?.access_token) throw new Error(result?.error_description || result?.error || "Identity provider did not return an access token"); localStorage.setItem(accessTokenKey, result.access_token); if (result.id_token) localStorage.setItem(idTokenKey, result.id_token); const expiresIn = Number(result.expires_in); if (Number.isFinite(expiresIn) && expiresIn > 0) localStorage.setItem(expiresAtKey, String(Date.now() + expiresIn * 1000)); else localStorage.removeItem(expiresAtKey); storage.removeItem(silentAttemptKey); const returnTo = storage.getItem(returnToKey) || "/"; storage.removeItem(verifierKey); storage.removeItem(stateKey); storage.removeItem(returnToKey); return returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"; }
export function beginOidcLogout(config?: OidcClientConfig): void { const idToken = window.localStorage.getItem(idTokenKey); window.localStorage.removeItem(idTokenKey); window.sessionStorage.removeItem(verifierKey); window.sessionStorage.removeItem(stateKey); window.sessionStorage.removeItem(returnToKey); let effective = config; if (!effective) { try { effective = readOidcClientConfig(); } catch { return; } } if (!effective.logoutUrl) return; const url = new URL(effective.logoutUrl); url.searchParams.set("post_logout_redirect_uri", window.location.origin + "/auth/login"); if (idToken) url.searchParams.set("id_token_hint", idToken); window.location.assign(url.toString()); }
`,
        "web/app/routes/auth-callback.tsx": `import { Alert, Card, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@refinedev/core";
import { completeOidcLogin, isSilentRenewFailure, oidcProviderLabel } from "../auth/oidc-client";
export default function AuthCallback() { const navigate = useNavigate(); const { translate } = useTranslation(); const [error, setError] = useState<string>(); useEffect(() => { void completeOidcLogin(window.location.href).then((target) => navigate(target, { replace: true })).catch((reason) => { const message = reason instanceof Error ? reason.message : String(reason); /* A silent renewal the provider refuses is not a failure: fall back to interactive login. */ if (isSilentRenewFailure(message)) { navigate("/auth/login", { replace: true }); return; } setError(message); }); }, [navigate]); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={translate("qiy.providerLoginFailed", { provider: oidcProviderLabel })} description={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>{translate("qiy.completingProviderSignIn", { provider: oidcProviderLabel })}</Typography.Paragraph></>}</Card></div>; }
`,
        "web/tests/oidc-client.test.ts": `import { expect, test } from "bun:test";
import { beginOidcSilentRenew, buildAuthorizationUrl, clearOidcSession, completeOidcLogin, consumeSilentAttempt, isSilentRenewFailure, oidcSession, readOidcClientConfig } from "../app/auth/oidc-client";
const config = { authorizationUrl: "https://id.example/authorize", tokenUrl: "https://id.example/token", clientId: "qiy-spa", scope: "openid profile", redirectUri: "https://admin.example/auth/callback" };
function memory(initial: Record<string, string> = {}) { const values = new Map(Object.entries(initial)); return { values, store: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } }; }
test("builds authorization-code PKCE requests without a client secret", async () => { const url = new URL(await buildAuthorizationUrl(config, "verifier-value", "state-value")); expect(url.searchParams.get("response_type")).toBe("code"); expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("state")).toBe("state-value"); expect(url.searchParams.has("client_secret")).toBe(false); expect(url.searchParams.has("prompt")).toBe(false); expect(new URL(await buildAuthorizationUrl(config, "verifier-value", "state-value", "none")).searchParams.get("prompt")).toBe("none"); });
test("requires provider endpoints and a public client id", () => { expect(() => readOidcClientConfig({}, "https://admin.example")).toThrow("VITE_QIY_AUTHORIZATION_URL"); });
test("exchanges a matching callback and fails closed on state mismatch", async () => { const session = new Map([["qiy.oidc.verifier", "verifier-value"], ["qiy.oidc.state", "state-value"], ["qiy.oidc.return_to", "/orders"]]); const local = new Map<string, string>(); const storage = { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value); }, removeItem: (key: string) => { session.delete(key); } }; const localStorage = { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => { local.delete(key); } }; const requests: RequestInit[] = []; const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(init ?? {}); return Response.json({ access_token: "access-token", id_token: "id-token" }); }) as typeof fetch; expect(await completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=state-value", storage, localStorage, fetcher, config)).toBe("/orders"); expect(local.get("qiy.access_token")).toBe("access-token"); expect(String(requests[0]?.body)).toContain("code_verifier=verifier-value"); session.set("qiy.oidc.verifier", "verifier-value"); session.set("qiy.oidc.state", "expected"); await expect(completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=wrong", storage, localStorage, fetcher, config)).rejects.toThrow("Invalid or expired OAuth state"); });
test("tracks token expiry and clears it on logout", async () => { const local = memory(); const session = memory(); const fetcher = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ access_token: "token-a", expires_in: 300 })) as typeof fetch; session.store.setItem("qiy.oidc.verifier", "verifier-value"); session.store.setItem("qiy.oidc.state", "state-value"); const started = Date.now(); await completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=state-value", session.store, local.store, fetcher, config); const expiresAt = Number(local.store.getItem("qiy.expires_at")); expect(expiresAt).toBeGreaterThanOrEqual(started + 300_000); expect(oidcSession({ storage: local.store, now: started }).expired).toBe(false); expect(oidcSession({ storage: local.store, now: started + 299_000 }).expired).toBe(false); expect(oidcSession({ storage: local.store, now: started + 300_001 }).expired).toBe(true); expect(oidcSession({ storage: local.store, now: started + 299_000, skewMs: 60_000 }).expired).toBe(true); clearOidcSession(local.store, session.store); expect(oidcSession({ storage: local.store, now: started }).expired).toBe(true); expect(local.store.getItem("qiy.expires_at")).toBeNull(); });
test("treats a provider without expires_in as usable and a missing token as expired", async () => { const local = memory(); const session = memory(); const fetcher = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ access_token: "token-b" })) as typeof fetch; session.store.setItem("qiy.oidc.verifier", "verifier-value"); session.store.setItem("qiy.oidc.state", "state-value"); await completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=state-value", session.store, local.store, fetcher, config); expect(local.store.getItem("qiy.expires_at")).toBeNull(); expect(oidcSession({ storage: local.store, now: Date.now() + 10 ** 12 }).expired).toBe(false); expect(oidcSession({ storage: memory().store }).expired).toBe(true); });
test("renews silently once per redirect cycle and detects provider refusal", async () => { const session = memory(); const assigned: string[] = []; const previous = Object.getOwnPropertyDescriptor(globalThis, "window"); try { Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://admin.example", pathname: "/orders", search: "", assign: (url: string) => { assigned.push(url); } }, sessionStorage: session.store, localStorage: memory().store } }); expect(consumeSilentAttempt(session.store)).toBe(true); expect(consumeSilentAttempt(session.store)).toBe(false); await beginOidcSilentRenew("/reports", config); const url = new URL(assigned[0]!); expect(url.searchParams.get("prompt")).toBe("none"); expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("client_secret")).toBeNull(); expect(session.store.getItem("qiy.oidc.return_to")).toBe("/reports"); expect(isSilentRenewFailure("login_required")).toBe(true); expect(isSilentRenewFailure("interaction_required")).toBe(true); expect(isSilentRenewFailure("access_denied")).toBe(false); expect(isSilentRenewFailure(undefined)).toBe(false); } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); } });
`,
      } : {}),
      "web/tests/auth.test.ts": `import { afterAll, beforeAll, expect, test } from "bun:test";
import { clearIdentityCache, qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = ${JSON.stringify(roles.least)};
let identityPermissions: string[] | undefined;
let identityGroups: string[] | undefined;
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: "http://localhost", pathname: "/", search: "", assign: () => {} } } });
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/auth/login") ? { accessToken: "local-test-token" } : { id: "test-user", role, ...(Array.isArray(identityPermissions) ? { permissions: identityPermissions } : {}), ...(Array.isArray(identityGroups) ? { groups: identityGroups } : {}) }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterAll(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); globalThis.fetch = originalFetch; });

test("authenticates using ${hasLocalAuth ? "username and password" : "the configured identity provider"}", async () => {
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
  ${hasLocalAuth ? 'expect((await qiyAuthProvider.login({ username: "admin", password: "correct-password" })).success).toBe(true); expect(tokens.get("qiy.access_token")).toBe("local-test-token");' : 'tokens.set("qiy.access_token", "test-token");'}
  expect((await qiyAuthProvider.check({})).authenticated).toBe(true);
});

test("matches the server role policy for every declared role", async () => {
${[...roles.names].reverse().map((role) => `  role = ${JSON.stringify(role)}; clearIdentityCache();\n${roleExpectations(role).join("\n")}`).join("\n")}
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});
test("decides every resource page action, so route guards cannot be bypassed by URL", async () => {
  tokens.set("qiy.access_token", "page-guard-token");
${[...roles.names].reverse().map((role) => `  role = ${JSON.stringify(role)}; clearIdentityCache();\n${roleExpectations(role).join("\n")}`).join("\n")}
  tokens.clear();
  role = ${JSON.stringify(roles.least)};
${roleExpectations(roles.least, true).join("\n")}
  tokens.set("qiy.access_token", "page-guard-token");
});
${actionPolicies.length ? `
test("matches each action role allowlist without an admin bypass", async () => {
  tokens.set("qiy.access_token", "policy-test-token");
  for (const policy of ${JSON.stringify(actionPolicies.filter((policy) => policy.roles.length && !policy.permissions?.length && !policy.verification))}) {
    for (const candidate of ${JSON.stringify(roles.names)}) {
      role = candidate;
      clearIdentityCache();
      expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes(candidate));
    }
  }
  tokens.clear();
  ${actionPolicies.map((policy) => `expect((await qiyAccessControlProvider.can({ resource: ${JSON.stringify(policy.resource)}, action: ${JSON.stringify(policy.action)} })).can).toBe(false);`).join("\n  ")}
});
` : ""}${webPermissionCases.length ? `
const permissionCases = ${JSON.stringify(webPermissionCases.map((item) => ({ policy: { resource: item.policy.resource, action: item.policy.action }, variant: item.variant })))};
test("permission-guarded commands follow effective permissions from /auth/me", async () => {
  tokens.set("qiy.access_token", "permission-test-token");
  for (const item of permissionCases) {
    role = item.variant.role;
    identityPermissions = item.variant.permissions;
    identityGroups = item.variant.groups;
    clearIdentityCache();
    expect({ policy: item.policy, allowed: (await qiyAccessControlProvider.can({ resource: item.policy.resource, action: item.policy.action })).can }).toEqual({ policy: item.policy, allowed: item.variant.expected });
  }
  // Without permission metadata the generated provider keeps the legacy role allow list.
  identityPermissions = undefined;
  identityGroups = undefined;
  role = ${JSON.stringify(roles.least)};
  clearIdentityCache();
  for (const policy of ${JSON.stringify(webPermissionPolicies.map((policy) => ({ resource: policy.resource, action: policy.action, roles: policy.roles })))}) {
    expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes(${JSON.stringify(roles.least)}));
  }
  tokens.clear();
});
` : ""}
`,
    } : {}),
    "web/app/hooks/index.ts": `export function useQiyTitle(title: string): string { return "Qiy · " + title; }\n`,
    ...renderViewFiles(options),
    "web/tests/field-rules.test.ts": `import { expect, test } from "bun:test";
import { canSeeField, getResource, resources } from "../app/resources";

const fieldRules: Array<{ resource: string; field: string; roles: string[] }> = ${JSON.stringify((options.pages ?? []).flatMap((page) => (page.fields ?? []).map((entry) => ({ resource: page.resource, field: entry.field, roles: entry.roles }))), null, 2)};

test("page field layout follows the declared roles", () => {
  for (const rule of fieldRules) {
    const resource = getResource(rule.resource);
    expect(resource).toBeDefined();
    const field = resource?.fields.find((candidate) => candidate.name === rule.field);
    expect(field).toBeDefined();
    expect(field?.roles).toEqual(rule.roles);
    // Every role outside the rule must not see the field, inside must see it.
    for (const role of ${JSON.stringify(roles.names)}) {
      expect(canSeeField(field!, role)).toBe(rule.roles.includes(role));
    }
    expect(canSeeField(field!, undefined)).toBe(false);
  }
});

test("fields without layout rules stay visible to every role", () => {
  for (const resource of resources) {
    for (const field of resource.fields) {
      if (field.roles) continue;
      for (const role of ${JSON.stringify(roles.names)}) expect(canSeeField(field, role)).toBe(true);
    }
  }
});
`,
    ...renderViewTestFiles(),
    ...renderExportFiles(),
    "web/app/components/related-records.tsx": `import { useList } from "@refinedev/core";
import { useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router";
import { canSeeField, getResource } from "../resources";
import { RelationCell } from "./relation-field";
import { formatFieldValue } from "../date-fields";
import { t, resolveLocale, type QiyLocale } from "../i18n";

interface RelatedResource { resource: string; field: string; label: string; labelKey: string; }

export function RelatedRecords({ relation, recordId }: { relation: RelatedResource; recordId: string }) {
  const { getLocale, translate } = useTranslation();
  const locale: QiyLocale = resolveLocale(getLocale());
  const resource = getResource(relation.resource);
  const { result, query } = useList<Record<string, unknown>>({
    resource: relation.resource,
    filters: [{ field: relation.field, operator: "eq", value: recordId }],
    pagination: { currentPage: 1, pageSize: 10 },
    queryOptions: { enabled: Boolean(recordId) },
  });
  const fields = resource?.fields.filter((field) => field.listVisible && !field.primaryKey && field.type !== "Vector").slice(0, 5) ?? [];
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => ({ title: translate(field.labelKey, {}, field.label), dataIndex: field.name, key: field.name, render: (value: unknown) => field.relation ? <RelationCell field={field} value={value} /> : formatFieldValue(field.type, value, locale) || "—" }));
  columns.push({ title: t(locale, "actions"), key: "actions", render: (_value, record) => <Link to={"/" + relation.resource + "/" + String(record.id)}>{t(locale, "view")}</Link> });
  if (!resource) return <Alert type="error" message={translate("qiy.relatedUnknown", { resource: relation.resource })} />;
  const total = result.total ?? 0;
  return <Card size="small" title={translate(relation.labelKey, {}, relation.label)} style={{ marginTop: 16 }}><Table<Record<string, unknown>> rowKey="id" loading={query.isLoading} dataSource={result.data} columns={columns} pagination={total > 10 ? { pageSize: 10, total, showSizeChanger: false } : false} scroll={{ x: "max-content" }} /></Card>;
}
`,
    "web/app/plugins/index.ts": `export interface WebPlugin { name: string; setup?(): void | Promise<void>; }\nexport const plugins: WebPlugin[] = [];\n`,
    "web/app/shared/types.ts": `export type ID = string;\nexport interface PageResult<T> { data: T[]; total: number; }\n`,
    "web/app/features/resources/index.ts": `export { resources, resourceNames, getResource } from "../../resources";\nexport type { ResourceDefinition, ResourceField, FieldType } from "../../resources";\n`,
    "web/app/resources.ts": `export type FieldType = "UUID" | "Text" | "Email" | "URL" | "JSON" | "Array" | "Integer" | "Boolean" | "Decimal" | "Money" | "Date" | "Time" | "DateTime" | "File" | "Files" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; labelKey: string; color?: string; icon?: string; comment?: string; commentKey?: string; }
export interface ResourceEnumDefinition { name: string; label?: string; labelKey?: string; comment?: string; commentKey?: string; values: ResourceEnumValue[]; }
export interface ResourceField { name: string; label: string; labelKey: string; comment?: string; commentKey?: string; type: FieldType; itemType?: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; filterModes: string[]; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; /** A many-to-many field: the value is an array of related ids. */ many?: boolean; icon?: string; dimension?: number; uploadMode?: "binary" | "base64" | "both"; maxBytes?: number; mimeTypes?: string[]; maxFiles?: number; /** Page-level layout: the field is only rendered for these roles. */ roles?: string[]; /** Filled by the server on create (@code / @generated / system UUID); hidden on create forms. */ autoGenerated?: boolean; /** @min/@max/@length/@pattern; the server enforces the same rules. */ rules?: { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string; example?: string }; /** @default literal that pre-fills create forms. */ defaultValue?: string | number | boolean; /** Any @default (including now): optional on create, the column fills an empty value. */ defaulted?: boolean; }
/** Page-level field layout check; a field without role rules is visible to everyone. */
export function canSeeField(field: ResourceField, role: string | undefined | null): boolean { return !field.roles || field.roles.includes(role ?? ""); }
/** Fields the create/edit form can edit: form-visible, not the primary key, not a Vector. */
export function isFormEditable(field: ResourceField): boolean { return field.formVisible && !field.primaryKey && field.type !== "Vector"; }
/** Create-form fields: generated values are filled by the server and never typed. */
export function createFormFields(resource: ResourceDefinition): ResourceField[] { return resource.fields.filter((field) => isFormEditable(field) && !field.autoGenerated); }
/** Edit-form fields: generated fields appear read-only so their value stays visible. */
export function editFormFields(resource: ResourceDefinition): ResourceField[] { return resource.fields.filter(isFormEditable); }
/** The generated fields of an edit form (rendered read-only and never submitted). */
export function generatedFormFields(resource: ResourceDefinition): ResourceField[] { return resource.fields.filter((field) => isFormEditable(field) && field.autoGenerated); }
 export interface ResourceDefinition { name: string; apiName: string; label: string; labelKey: string; singular: string; singularKey: string; plural: string; pluralKey: string; displayTemplate?: string; tableDisplayTemplate?: string; relationDetailTemplate?: string; comment?: string; commentKey?: string; icon: string; liveMode: "auto" | "manual" | "off"; readOnly?: boolean; hasDetail?: boolean; softDelete?: boolean; /** The @version counter the edit form sends back to detect concurrent edits. */ versionField?: string; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string; labelKey: string }>; }
/** A sidebar group declared in the model menu block. */
export interface MenuGroupDefinition { name: string; label: string; labelKey: string; icon: string; parent?: string; comment?: string; commentKey?: string; /** Resources (table names) in the declared menu order. */ resources: string[]; }
export const enumerations: ResourceEnumDefinition[] = ${JSON.stringify(enumerationDefinitions(database), null, 2)};
export const menuGroups: MenuGroupDefinition[] = ${JSON.stringify(menuGroups.map((group) => ({ name: `menu-${group.name}`, label: group.label, labelKey: qiyModelKeys.menuLabel(group.name), icon: group.icon ?? "AppstoreOutlined", ...(group.parent && { parent: `menu-${group.parent}` }), ...(group.comment !== undefined && { comment: group.comment }), ...(group.commentKey !== undefined && { commentKey: group.commentKey }), resources: group.resources })), null, 2)};
export const resources: ResourceDefinition[] = ${resourceFields(database, menuGroups, options.realtime, options.pages)};
export const resourceNames = ${JSON.stringify(resourceNames)} as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
`,
    ...(Object.keys(treeEntities).length ? {
      "web/app/components/tree-view.tsx": `import { useList, useTranslation } from "@refinedev/core";
import { Alert, Card, Empty, Space, Spin, Tree } from "antd";
import { useNavigate } from "react-router";
import { useState } from "react";
import { buildTree, type QiyTreeNode } from "../tree";
import { getResource } from "../resources";

type AntdNode = { key: string; title: string; children: AntdNode[] };
const toAntd = (nodes: Array<QiyTreeNode<Record<string, unknown>>>): AntdNode[] => nodes.map((node) => ({ key: node.key, title: node.title, children: toAntd(node.children) }));

export function TreeView({ resource, parentField, labelField }: { resource: string; parentField: string; labelField: string }) {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const config = getResource(resource);
  const [expanded, setExpanded] = useState<string[]>([]);
  const { result, query } = useList({ resource, pagination: { mode: "off" } });
  const records = (result.data ?? []) as Array<Record<string, unknown>>;
  const { nodes, orphans } = buildTree(records, parentField, labelField);
  return <Card title={config ? translate(config.labelKey, {}, config.label) : resource} extra={<span>{translate("qiy.treeNodesCount", { nodes: records.length })}</span>}>
    {query.isLoading && <Spin />}
    {query.error && <Alert type="error" message={String(query.error)} />}
    {!query.isLoading && !records.length && <Empty />}
    <Tree treeData={toAntd(nodes)} expandedKeys={expanded} onExpand={(keys) => setExpanded(keys.map(String))} onSelect={(keys) => { const id = String(keys[0] ?? ""); if (id) navigate("/" + resource + "/" + id); }} />
    {orphans.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 16 }} message={translate("qiy.treeOrphans", { nodes: orphans.length })} />}
  </Card>;
}
`,
      "web/app/routes/tree.tsx": `import { Alert } from "antd";
import { useParams } from "react-router";
import { getResource } from "../resources";
import { treeParents } from "../tree";
import { TreeView } from "../components/tree-view";

export default function ResourceTree() {
  const { resource: name } = useParams();
  const resource = getResource(name);
  const config = name ? treeParents[name] : undefined;
  if (!resource || !config) return <Alert type="error" message="This resource has no tree configuration" />;
  return <TreeView resource={resource.name} parentField={config.parentField} labelField={config.labelField} />;
}
`,
    } : {}),
    "web/app/routes/home.tsx": `import { CanAccess, useList, useTranslation } from "@refinedev/core";
import { Card, Col, Row, Space, Statistic, Typography, theme } from "antd";
import { Link } from "react-router";
import { resources, type ResourceDefinition } from "../resources";
import { chartPanels, charts } from "../charts";
import { ChartDashboard } from "../components/charts";
import { qiyIcons } from "../icons";
import { t, resolveLocale, type QiyLocale } from "../i18n";

function ResourceSummary({ resource }: { resource: ResourceDefinition }) {
  const { translate } = useTranslation();
  const { result, query } = useList({ resource: resource.name, pagination: { currentPage: 1, pageSize: 1 } });
  const { token } = theme.useToken();
  const Icon = qiyIcons[resource.icon as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
  return <Col xs={24} sm={12} lg={8}><Link to={\`/\${resource.name}\`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: token.colorPrimary }} /><div><Typography.Text type="secondary">{translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label))}</Typography.Text><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale, translate } = useTranslation(); const locale: QiyLocale = resolveLocale(getLocale());
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{t(locale, "overview")}</Typography.Title><Typography.Paragraph type="secondary">{t(locale, "overviewDescription")}</Typography.Paragraph></div>{charts.length > 0 ? <ChartDashboard charts={charts} panels={chartPanels} /> : <Row gutter={[16, 16]}>{resources.filter((resource) => !resource.readOnly).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><ResourceSummary resource={resource} /></CanAccess>)}</Row>}<Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={\`/\${resource.name}\`}>{translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label))}</Link></CanAccess>)}</Space></Card></Space>;
}
`,
    ...renderI18nFiles(options),
    "web/app/components/resource-page-guard.tsx": `import { CanAccess, useTranslation } from "@refinedev/core";
import { Result } from "antd";
import { useParams } from "react-router";
import { Outlet } from "react-router";
import { resolveLocale } from "../i18n";

export type ResourcePageAction = "list" | "create" | "show" | "edit";

/**
 * Page level authorization for resource routes. The access-control decision is
 * evaluated for the page action before the page renders, so navigating directly
 * to a URL cannot bypass the menu or button visibility rules.
 */
export function ResourcePageGuard({ action }: { action: ResourcePageAction }) {
  const { resource } = useParams();
  const { getLocale, translate } = useTranslation();
  const locale = resolveLocale(getLocale());
  if (!resource) return <Outlet />;
  return <CanAccess resource={resource} action={action} fallback={<Result status="403" title="403" subTitle={translate("qiy.forbidden", {}, locale === "zh-CN" ? "没有访问该页面的权限" : "You are not allowed to open this page")} />}><Outlet /></CanAccess>;
}
`,
    "web/app/routes/guard-list.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardList() { return <ResourcePageGuard action="list" />; }
`,
    "web/app/routes/guard-create.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardCreate() { return <ResourcePageGuard action="create" />; }
`,
    "web/app/routes/guard-show.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardShow() { return <ResourcePageGuard action="show" />; }
`,
    "web/app/routes/guard-edit.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardEdit() { return <ResourcePageGuard action="edit" />; }
`,
    "web/app/routes/list.tsx": `import { useCan, useDeleteMany, useGetIdentity, useNotification, useTranslation } from "@refinedev/core";
import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";
import { Alert, Button, Checkbox, Dropdown, Input, Popconfirm, Popover, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { canSeeField, getResource, type ResourceField } from "../resources";
import { RelationCell, RelationSelect } from "../components/relation-field";
import { RelationBatchProvider, buildRelationBatchPlan } from "../components/relation-batch";
import { DateFieldInput } from "../components/date-field";
import { formatFieldValue, isDateFieldType, type DateFieldType } from "../date-fields";
import { fetchServerViews, publishServerView, deleteServerView, type QiyServerView } from "../views-api";
import { useColumnVisibility } from "../hooks/use-column-visibility";
import { qiyIcons } from "../icons";
import { downloadExport, exportUrl, startImport, waitForImport } from "../export";
import { canDeleteView, deleteSavedView, listSavedViews, saveView, serverViewId, serverViewKey, viewMarker, type QiySavedViewKind } from "../views";
import { t, filterModeLabel, resolveLocale, type QiyLocale } from "../i18n";
import { downloadFile } from "../hooks/download-file";
import type { BaseRecord } from "@refinedev/core";

function renderCell(field: ResourceField, value: unknown, notify: ReturnType<typeof useNotification>["open"], translate: ReturnType<typeof useTranslation>["translate"], locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.relation) return <RelationCell field={field} value={value} />;
  if (field.type === "File") return <Typography.Link onClick={() => void downloadFile(String(value)).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{String(value)}</Typography.Link>;
  if (field.type === "Files") {
    const keys = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    if (!keys.length) return "—";
    return <Space wrap>{keys.map((key) => <Typography.Link key={key} onClick={() => void downloadFile(key).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{key.split("/").pop()}</Typography.Link>)}</Space>;
  }
  if (isDateFieldType(field.type)) return formatFieldValue(field.type, value, locale);
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) { const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined; const comment = enumValue.commentKey ? translate(enumValue.commentKey, {}, enumValue.comment) : enumValue.comment; return <Tag title={comment} color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{translate(enumValue.labelKey, {}, enumValue.label ?? enumValue.name)}</Tag>; }
  if (field.name.toLowerCase().includes("status") || field.name.toLowerCase() === "role") return <Typography.Text code>{String(value)}</Typography.Text>;
  if (field.type === "Money" || field.type === "Decimal") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}
/**
 * One row of the "Saved views" dropdown. Browser views are personal, published
 * server views are private to their owner and shared views are visible to everyone.
 * Only deletable rows (own server rows and local rows) render the trash action, and
 * the action stops propagation so deleting never selects the view first.
 */
function SavedViewLabel({ viewKey, name, kind, shared, mine, deleting, onDelete, translate }: { viewKey: string; name: string; kind: QiySavedViewKind; shared: boolean; mine?: boolean; deleting: boolean; onDelete: (key: string) => void; translate: ReturnType<typeof useTranslation>["translate"] }) {
  const marker = viewMarker(kind, shared);
  const markerKey = marker === "local" ? "qiy.viewMine" : marker === "shared" ? "qiy.viewSharedTag" : "qiy.viewPublishedTag";
  const markerFallback = marker === "local" ? "Personal" : marker === "shared" ? "Shared" : "Published";
  const markerColor = marker === "local" ? "default" : marker === "shared" ? "green" : "blue";
  return <Space>
    <span>{name}</span>
    <Tag color={markerColor} style={{ marginInlineEnd: 0 }}>{translate(markerKey, {}, markerFallback)}</Tag>
    {canDeleteView({ kind, mine }) && <span onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <Popconfirm title={translate("qiy.confirmDeleteView", {}, "Delete this view?")} okText={translate("qiy.delete", {}, "Delete")} cancelText={translate("qiy.cancel", {}, "Cancel")} onConfirm={() => onDelete(viewKey)}>
        <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} aria-label={translate("qiy.deleteView", {}, "Delete view")} />
      </Popconfirm>
    </span>}
  </Space>;
}
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { translate, getLocale } = useTranslation(); const { open: notify } = useNotification(); const { data: identity } = useGetIdentity<{ role?: string }>(); const locale: QiyLocale = resolveLocale(getLocale());
  const { tableProps, tableQuery, setFilters, setSorters, filters, sorters } = useTable<Record<string, unknown>>({ resource: name ?? "", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savedViews, setSavedViews] = useState(() => listSavedViews(name ?? ""));
  const [activeView, setActiveView] = useState<string | undefined>(undefined);
  const [viewName, setViewName] = useState("");
  const [serverViews, setServerViews] = useState<QiyServerView[]>([]);
  const [deletingView, setDeletingView] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!name) return undefined;
    let active = true;
    void fetchServerViews(name).then((items) => { if (active) setServerViews(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [name]);
  const applySavedView = (id: string | undefined) => { setActiveView(id); const serverId = serverViewId(id); const view = serverId ? serverViews.find((item) => item.id === serverId) : savedViews.find((item) => item.id === id); if (!view) return; setSearch(view.search ?? ""); setFilters((view.filters ?? []) as never); setSorters((view.sorters ?? []) as never); if (view.columns?.length) { const columns = view.columns; setVisibleKeys(() => columns); } };
  const storeSavedView = () => { if (!viewName.trim() || !resource) return; setSavedViews(saveView(resource.name, { name: viewName, search, filters: filters as unknown[], sorters: sorters as unknown[], columns: visibleKeys })); setViewName(""); notify?.({ type: "success", message: translate("qiy.saved", {}, "View saved") }); };
  /**
   * Deletes browser views from localStorage and server views through
   * DELETE /api/v1/saved-views/:id, then refetches so the dropdown matches the server.
   */
  const removeSavedView = async (key: string) => {
    if (!resource) return;
    setDeletingView(key);
    const serverId = serverViewId(key);
    try {
      if (serverId) {
        await deleteServerView({ resource: resource.name, id: serverId });
        setServerViews(await fetchServerViews(resource.name));
      } else {
        setSavedViews(deleteSavedView(resource.name, key));
      }
      if (activeView === key) setActiveView(undefined);
      notify?.({ type: "success", message: translate("qiy.viewDeleted", {}, "View deleted") });
    } catch {
      // Leave the row in place on failure: only the server may confirm a remote delete.
      notify?.({ type: "error", message: translate("qiy.viewDeleteFailed", {}, "Deleting the view failed") });
    } finally {
      setDeletingView(undefined);
    }
  };
  const publishSavedView = async (shared: boolean) => {
    if (!resource || !activeView) return;
    const personal = savedViews.find((item) => item.id === activeView);
    const serverId = serverViewId(activeView);
    const server = serverId ? serverViews.find((item) => item.id === serverId) : undefined;
    const view = personal ?? server;
    if (!view) return;
    try {
      // POST is an upsert keyed by name, so republishing never adds a duplicate row.
      const published = await publishServerView({ resource: resource.name, name: view.name, shared, search: view.search, filters: view.filters as unknown[] | undefined, sorters: view.sorters as unknown[] | undefined, columns: view.columns });
      setServerViews(await fetchServerViews(resource.name));
      // A published local view now lives on the server; drop the browser copy and follow the server row.
      if (!serverId) setSavedViews(deleteSavedView(resource.name, activeView));
      setActiveView(serverViewKey(published.id));
      notify?.({ type: "success", message: shared ? translate("qiy.viewShared", {}, "View shared with everyone") : translate("qiy.viewPublished", {}, "View saved to server") });
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : translate("qiy.publishFailed", {}, "Publishing the view failed") });
    }
  };
  const runExport = () => { if (!resource) return; setExporting(true); void downloadExport(exportUrl(resource.name, { filters, sorters, columns: visibleKeys${options.readOnly ? "" : ", ids: selectedRowKeys.map(String)"} })).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setExporting(false)); };
  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });
  const [search, setSearch] = useState(""); const enumFields = resource?.fields.filter((field) => field.filterable && field.enumValues?.length) ?? []; const advancedFields = resource?.fields.filter((field) => field.filterable && !field.enumValues?.length && field.filterModes?.length) ?? []; const [enumFilters, setEnumFilters] = useState<Record<string, string | undefined>>({}); const [advancedFilters, setAdvancedFilters] = useState<Record<string, { operator: string; value: string }>>({}); const [advancedJoin, setAdvancedJoin] = useState<"and" | "or">("and");
  const { visibleKeys, setVisibleKeys } = useColumnVisibility(resource);
  const relationBatchFields = useMemo(() => (resource?.fields ?? []).filter((field) => field.relation && field.listVisible && canSeeField(field, identity?.role)), [resource, identity?.role]);
  const relationBatchRows = (tableProps.dataSource ?? []) as Array<Record<string, unknown>>;
  // One batched FK request per target resource instead of one getOne per cell. The
  // plan is memoized so a re-render (e.g. an identity or selection update) cannot
  // retrigger the batch queries.
  const relationBatchPlan = useMemo(() => buildRelationBatchPlan(relationBatchFields, relationBatchRows), [relationBatchFields, relationBatchRows]);
  if (!resource) return <Alert type="error" message={translate("qiy.unknownResource", {}, t(locale, "unknownResource"))} />;
  // Menu/list titles use @plural, create/edit titles use @singular; both fall
  // back to the translated resource label so older dictionaries keep working.
  const singular = translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular));
  const plural = translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label));
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name) && canSeeField(field, identity?.role));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => {
    const Icon = field.icon ? qiyIcons[field.icon as keyof typeof qiyIcons] : undefined;
    return { title: <Space>{Icon && <Icon />}<span>{translate(field.labelKey, {}, field.label)}</span></Space>, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => renderCell(field, value, notify, translate, locale) };
  });
  if (resource.readOnly && resource.hasDetail) columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space><ShowButton resource={resource.name} recordItemId={String(record.id)} hideText /></Space> });
  if (!resource.readOnly) columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space>
    <ShowButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />
  </Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };
  const applyFilters = (nextSearch = search, nextEnums = enumFilters, nextAdvanced = advancedFilters, nextAdvancedJoin = advancedJoin) => { const filters: Array<{ field: string; operator: string; value: string | string[] } | { operator: "and" | "or"; value: Array<{ field: string; operator: string; value: string | string[] }> }> = nextSearch ? [{ field: "__search", operator: "contains", value: nextSearch }] : []; for (const [field, value] of Object.entries(nextEnums)) if (value) filters.push({ field, operator: "eq", value }); const advanced = Object.entries(nextAdvanced).flatMap(([field, condition]) => !condition.value ? [] : [{ field, operator: condition.operator, value: condition.operator === "in" || condition.operator === "between" ? condition.value.split(",").map((item) => item.trim()) : condition.value }]); if (advanced.length === 1) filters.push(advanced[0]!); else if (advanced.length > 1) filters.push({ operator: nextAdvancedJoin, value: advanced }); setFilters(filters as never); };
  return <List resource={resource.name} title={<Typography.Title level={3} style={{ margin: 0 }}>{plural}</Typography.Title>} headerButtons={() => <Space wrap>${options.readOnly ? "" : '{!resource.readOnly && <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { setImporting(true); void startImport(resource.name, file).then(({ jobId }) => waitForImport(resource.name, jobId, { onProgress: (progress) => notify?.({ type: "progress", message: translate("qiy.importProgress", { processed: progress.processed, total: progress.total }) }) })).then((job) => { if (job.status === "failed") throw new Error(job.errors[0] ?? translate("qiy.importFailed", {}, "Import failed")); notify?.({ type: "success", message: translate("qiy.importedRows", { rows: job.processed }) }); return tableQuery.refetch(); }).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setImporting(false)); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />} loading={importing}>{translate("qiy.import", {}, "Import CSV")}</Button></Upload>}'}<Button icon={<DownloadOutlined />} loading={exporting} onClick={runExport}>{${options.readOnly ? 'translate("qiy.export", {}, "Export CSV")' : 'selectedRowKeys.length > 0 ? translate("qiy.exportSelected", {}, "Export selected") + " (" + selectedRowKeys.length + ")" : translate("qiy.export", {}, "Export CSV")'}}</Button><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{translate(field.labelKey, {}, field.label)}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><Select allowClear style={{ minWidth: 160 }} placeholder={translate("qiy.views", {}, "Saved views")} value={activeView} options={[...savedViews.map((view) => ({ value: view.id, label: <SavedViewLabel viewKey={view.id} name={view.name} kind="local" shared={false} deleting={deletingView === view.id} onDelete={removeSavedView} translate={translate} /> })), ...serverViews.map((view) => { const key = serverViewKey(view.id); return { value: key, label: <SavedViewLabel viewKey={key} name={view.name} kind="server" shared={view.shared} mine={view.mine} deleting={deletingView === key} onDelete={removeSavedView} translate={translate} /> }; })]} onChange={(value) => applySavedView(value)} /><Popover trigger="click" content={<Space direction="vertical"><Input value={viewName} placeholder={translate("qiy.viewName", {}, "View name")} onChange={(event) => setViewName(event.target.value)} onPressEnter={storeSavedView} /><Button type="primary" disabled={!viewName.trim()} onClick={storeSavedView}>{translate("qiy.save", {}, "Save")}</Button></Space>}><Button icon={<SaveOutlined />}>{translate("qiy.saveView", {}, "Save view")}</Button></Popover>{activeView && <Popover trigger="click" content={<Space direction="vertical"><Button onClick={() => void publishSavedView(false)}>{translate("qiy.saveToServer", {}, "Save to server")}</Button><Button onClick={() => void publishSavedView(true)}>{translate("qiy.shareView", {}, "Share with everyone")}</Button></Space>}><Button icon={<UploadOutlined />}>{translate("qiy.publishView", {}, "Publish view")}</Button></Popover>}
    ${Object.keys(treeEntities).length ? `{${JSON.stringify(Object.keys(treeEntities))}.includes(resource.name) && <Link to={"/" + resource.name + "/tree"}><Button>{translate("qiy.treeView", {}, "Tree view")}</Button></Link>}` : ""}${hasSoftDelete ? `{resource.softDelete && deletePermission?.can && <Link to={"/" + resource.name + "/trash"}><Button icon={<DeleteOutlined />}>{translate("qiy.trash", {}, "Trash")}</Button></Link>}` : ""}{!resource.readOnly && <CreateButton resource={resource.name}>{translate("qiy.createResource", { resource: singular }, singular)}</CreateButton>}</Space>}>
    <div className="qiy-list-filters" role="search" aria-label={t(locale, "filters")}><Input.Search allowClear value={search} placeholder={t(locale, "search")} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => { setSearch(value); applyFilters(value); }} />{enumFields.map((field) => <Select key={field.name} allowClear value={enumFilters[field.name]} placeholder={translate(field.labelKey, {}, field.label)} options={field.enumValues?.map((item) => ({ value: item.name, label: translate(item.labelKey, {}, item.label ?? item.name) }))} onChange={(value) => { const next = { ...enumFilters, [field.name]: value }; setEnumFilters(next); applyFilters(search, next); }} />)}{advancedFields.length > 1 && <Select value={advancedJoin} style={{ minWidth: 116 }} options={[{ value: "and", label: t(locale, "matchAll") }, { value: "or", label: t(locale, "matchAny") }]} onChange={(value: "and" | "or") => { setAdvancedJoin(value); applyFilters(search, enumFilters, advancedFilters, value); }} />}{advancedFields.map((field) => { const condition = advancedFilters[field.name] ?? { operator: field.filterModes[0] ?? "eq", value: "" }; return <Space.Compact key={field.name}><Select value={condition.operator} style={{ width: 120 }} options={field.filterModes.map((mode) => ({ value: mode, label: filterModeLabel(locale, mode) }))} onChange={(operator) => { const next = { ...advancedFilters, [field.name]: { ...condition, operator } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} />{field.relation && (condition.operator === "eq" || condition.operator === "in") ? <RelationSelect relation={field.relation} fieldName={field.name} multiple={condition.operator === "in"} style={{ minWidth: 200 }} value={condition.operator === "in" ? condition.value.split(",").filter(Boolean) : condition.value || undefined} onChange={(next) => { const value = Array.isArray(next) ? next.join(",") : next ?? ""; const nextFilters = { ...advancedFilters, [field.name]: { ...condition, value } }; setAdvancedFilters(nextFilters); applyFilters(search, enumFilters, nextFilters); }} /> : isDateFieldType(field.type) && condition.operator !== "in" && condition.operator !== "between" ? <DateFieldInput type={field.type as DateFieldType} value={condition.value} placeholder={translate(field.labelKey, {}, field.label)} onChange={(next) => { const nextFilters = { ...advancedFilters, [field.name]: { ...condition, value: next ?? "" } }; setAdvancedFilters(nextFilters); applyFilters(search, enumFilters, nextFilters); }} /> : <Input allowClear value={condition.value} placeholder={translate(field.labelKey, {}, field.label) + (condition.operator === "in" || condition.operator === "between" ? t(locale, "commaSeparated") : "")} onChange={(event) => { const next = { ...advancedFilters, [field.name]: { ...condition, value: event.target.value } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} />}</Space.Compact>; })}</div>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {!resource.readOnly && deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <RelationBatchProvider plan={relationBatchPlan}>
    <Table<Record<string, unknown>> {...tableProps} pagination={{ ...tableProps.pagination, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"], showTotal: (total: number, range: [number, number]) => translate("qiy.paginationTotal", { start: range[0], end: range[1], total }), locale: { items_per_page: t(locale, "perPage"), page: t(locale, "page") } }} rowSelection={!resource.readOnly && deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined} rowKey="id" columns={columns} scroll={{ x: "max-content" }} />
    </RelationBatchProvider>
  </List>;
}
`,
    "web/tests/column-visibility.test.ts": `import { expect, test } from "bun:test";
import { loadColumns } from "../app/hooks/use-column-visibility";
import { resources } from "../app/resources";

test("keeps column choices per resource and adopts new default columns", () => {
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null } } });
  try {
    const resource = resources[0]!;
    const defaults = loadColumns(resource);
    expect(defaults).toEqual(resource.fields.filter((field) => field.listVisible).map((field) => field.name));
    storage.set("qiy.columns." + resource.name, JSON.stringify({ fields: [resource.fields[0]!.name], selected: [] }));
    expect(loadColumns(resource)).toEqual(defaults.filter((name) => name !== resource.fields[0]!.name));
    if (resources[1]) expect(loadColumns(resources[1])).toEqual(resources[1].fields.filter((field) => field.listVisible).map((field) => field.name));
  } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
});
`,
    ...(generatedFieldsTest ? { "web/tests/generated-fields.test.ts": `import { expect, test } from "bun:test";
import { createFormFields, editFormFields, generatedFormFields, resources } from "../app/resources";
import { createI18nProvider } from "../app/i18n";
${generatedFieldsTest}` } : {}),
    ...(distributionEntity && distributionField ? { "web/tests/distribution.test.ts": `import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

test("REST distribution fetches aggregated counts without a page-size limit", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json([{ value: "draft", count: 150 }, { value: "approved", count: 100 }]); }) as typeof fetch;
  const result = await createDataProvider(fetcher).custom?.({ url: "/api/v1/${distributionEntity.tableName}/distribution", method: "get", query: { field: "${distributionField.name}" } });
  expect(result?.data.items).toEqual([{ value: "draft", count: 150 }, { value: "approved", count: 100 }]);
  expect(requests).toEqual(["/api/v1/${distributionEntity.tableName}/distribution?field=${distributionField.name}"]);
  await expect(createDataProvider(fetcher).custom?.({ url: "/api/v1/${distributionEntity.tableName}/distribution", method: "get", query: { field: "missing" } })).rejects.toThrow("Unknown distribution field");
});

test("GraphQL distribution selects the same server aggregate", async () => {
  const requests: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(String(init?.body)); return Response.json({ data: { ${distributionEntity.name}Distribution: [{ value: "draft", count: 150 }] } }); }) as typeof fetch;
  const result = await createGraphQLDataProvider(fetcher).custom?.({ url: "/api/v1/${distributionEntity.tableName}/distribution", method: "get", query: { field: "${distributionField.name}" } });
  expect(result?.data.items).toEqual([{ value: "draft", count: 150 }]);
  expect(JSON.parse(requests[0]!).variables).toEqual({ field: "${distributionField.name}" });
});
` } : {}),
    ...(trendEntity && trendField ? { "web/tests/trend.test.ts": `import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

test("REST trend requests the selected UTC day window", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json([{ day: "2026-10-06", count: 2 }]); }) as typeof fetch;
  const endpoint = "/api/v1/${trendEntity.tableName}/trend";
  const result = await createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "${trendField.name}", days: 30 } });
  expect(result?.data.items).toEqual([{ day: "2026-10-06", count: 2 }]);
  expect(requests).toEqual([endpoint + "?field=${trendField.name}&days=30"]);
  await expect(createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "${trendField.name}", days: 366 } })).rejects.toThrow("Invalid trend days");
  await expect(createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "missing", days: 30 } })).rejects.toThrow("Unknown trend field");
});

test("GraphQL trend requests the same field and day window", async () => {
  const requests: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(String(init?.body)); return Response.json({ data: { ${trendEntity.name}Trend: [{ day: "2026-10-06", count: 2 }] } }); }) as typeof fetch;
  const result = await createGraphQLDataProvider(fetcher).custom?.({ url: "/api/v1/${trendEntity.tableName}/trend", method: "get", query: { field: "${trendField.name}", days: 30 } });
  expect(result?.data.items).toEqual([{ day: "2026-10-06", count: 2 }]);
  expect(JSON.parse(requests[0]!).variables).toEqual({ field: "${trendField.name}", days: 30 });
});
` } : {}),
    ...renderI18nTestFiles(actionDefinitions, localeSwitchTest),
    "web/tests/date-fields.test.ts": `import { describe, expect, test } from "bun:test";
import dayjs from "dayjs";
import { formatFieldValue, isDateFieldType, toFormValue, toPayloadValue } from "../app/date-fields";

describe("Date/Time/DateTime form contracts", () => {
  test("converts stored contract strings into picker values", () => {
    expect(toFormValue("Date", "2026-11-30")?.format("YYYY-MM-DD")).toBe("2026-11-30");
    expect(toFormValue("Time", "14:30:05")?.format("HH:mm:ss")).toBe("14:30:05");
    expect(toFormValue("Time", "14:30")?.format("HH:mm:ss")).toBe("14:30:00");
    expect(toFormValue("DateTime", "2026-11-30T08:30:00.000Z")?.toISOString()).toBe("2026-11-30T08:30:00.000Z");
    expect(toFormValue("Date", null)).toBeNull();
  });

  test("converts picker values back to the API contract", () => {
    expect(toPayloadValue("Date", dayjs("2026-11-30"))).toBe("2026-11-30");
    expect(toPayloadValue("Time", dayjs("1970-01-01T14:30:05"))).toBe("14:30:05");
    expect(toPayloadValue("DateTime", dayjs("2026-11-30T08:30:00.000Z"))).toBe("2026-11-30T08:30:00.000Z");
    expect(toPayloadValue("Date", null)).toBeNull();
    expect(toPayloadValue("Time", undefined)).toBeNull();
    // Values already in the contract (form.setFieldsValue) pass through unchanged.
    expect(toPayloadValue("Date", "2026-11-30")).toBe("2026-11-30");
  });

  test("invalid stored input never becomes an invalid picker value", () => {
    expect(toFormValue("Date", "not-a-date")).toBeNull();
    expect(toFormValue("Date", "2026-13-01")).toBeNull();
    expect(toFormValue("Time", "25:00:00")).toBeNull();
    expect(toFormValue("Time", "08:30:00Z")).toBeNull();
    expect(toFormValue("DateTime", "tomorrow")).toBeNull();
  });

  test("formats display text with Intl and falls back to the raw string", () => {
    expect(formatFieldValue("Date", "2026-11-30", "en-US")).toContain("2026");
    expect(formatFieldValue("Date", "2026-11-30", "zh-CN")).toContain("2026");
    expect(formatFieldValue("Time", "08:30:00", "zh-CN")).toBe("08:30:00");
    expect(formatFieldValue("Time", "08:30:00", "en-US")).toMatch(/8:30:00/);
    expect(formatFieldValue("DateTime", "2026-11-30T08:30:00.000Z", "en-US")).toContain("2026");
    expect(formatFieldValue("Date", "not-a-date", "en-US")).toBe("not-a-date");
    expect(formatFieldValue("Date", "2026-13-01", "en-US")).toBe("2026-13-01");
    expect(formatFieldValue("Text", "plain")).toBe("plain");
    expect(formatFieldValue("Date", null)).toBe("");
    expect(isDateFieldType("DateTime")).toBe(true);
    expect(isDateFieldType("Text")).toBe(false);
  });
});
`,
    "web/tests/display-template.test.ts": `import { describe, expect, test } from "bun:test";
import { escapeHtml, plainTextTemplate, recordDisplayText, relationDetailHtml, renderTemplate } from "../app/display-template";
import type { ResourceDefinition, ResourceField } from "../app/resources";

const fields = [
  { name: "code", type: "Text", label: "Code", labelKey: "code", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"] },
  { name: "status", type: "Text", label: "Status", labelKey: "status", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"], enumValues: [{ name: "active", label: "Active", labelKey: "qiy.enums.state.values.active" }] },
] as unknown as ResourceField[];

const translate = (key: string, _options?: Record<string, unknown>, fallback?: string) => key === "qiy.enums.state.values.active" ? "启用" : fallback ?? key;

describe("display templates", () => {
  test("escapes every interpolated value and literal text", () => {
    expect(renderTemplate("<b>{$.name}</b>", { name: "<img src=x onerror=alert(1)>" })).toBe("<b>&lt;img src=x onerror=alert(1)&gt;</b>");
    expect(renderTemplate("{$.value}", { value: "a&b \\"quoted\\" 'single'" })).toBe("a&amp;b &quot;quoted&quot; &#39;single&#39;");
    expect(renderTemplate("1 < 2", {})).toBe("1 &lt; 2");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("only whitelisted tags survive at render time", () => {
    expect(renderTemplate("<script>{$.id}</script>", { id: "x" })).toBe("x");
    expect(renderTemplate("<img src=x>{$.id}", { id: "x" })).toBe("&lt;img src=x&gt;x");
    expect(renderTemplate("<b>{$.id}</b>", { id: "x" })).toBe("<b>x</b>");
    expect(renderTemplate("{$.a}</br>{$.b}<br/><br>", { a: "1", b: "2" })).toBe("1<br>2<br><br>");
  });

  test("missing placeholders collapse and options.empty is honored", () => {
    expect(renderTemplate("{$.missing}{$.name}", { name: "Ada" })).toBe("Ada");
    expect(renderTemplate("{$.missing}", {}, { empty: "—" })).toBe("—");
    expect(renderTemplate(undefined, {})).toBe("");
  });

  test("plain text strips tags for select options and cell text", () => {
    expect(plainTextTemplate("<b>{$.code}</b></br>{$.status}", { code: "C-1", status: "active" }, { fields, translate })).toBe("C-1 启用");
    expect(plainTextTemplate("{$.code} · {$.status}", { code: "C-1", status: "active" }, { fields, translate })).toBe("C-1 · 启用");
    expect(plainTextTemplate("<div>a</div><div>b</div>", {})).toBe("a b");
  });

  test("record display falls back from template to label field to id", () => {
    const resource = { displayTemplate: "{$.code} · {$.status}", fields } as unknown as ResourceDefinition;
    expect(recordDisplayText(resource, { id: "uuid-1", code: "C-1", status: "active" }, { fields, translate })).toBe("C-1 · 启用");
    const tableResource = { ...resource, tableDisplayTemplate: "TABLE {$.code}" } as unknown as ResourceDefinition;
    expect(recordDisplayText(tableResource, { id: "uuid-1", code: "C-1" }, { fields, translate })).toBe("TABLE C-1");
    const plain = { fields } as unknown as ResourceDefinition;
    expect(recordDisplayText(plain, { id: "uuid-1", code: "C-1" })).toBe("C-1");
    expect(recordDisplayText(plain, { id: "uuid-1" })).toBe("uuid-1");
    expect(recordDisplayText(undefined, { id: "uuid-1" })).toBe("uuid-1");
  });

  test("relation detail is rendered HTML with escaped values", () => {
    const resource = { relationDetailTemplate: "<b>{$.name}</b></br>{$.note}", fields } as unknown as ResourceDefinition;
    expect(relationDetailHtml(resource, { name: "Ada", note: "<b>not markup</b>" })).toBe("<b>Ada</b><br>&lt;b&gt;not markup&lt;/b&gt;");
    expect(relationDetailHtml(resource, {})).toBe("<b></b><br>");
    expect(relationDetailHtml(undefined, { name: "Ada" })).toBe("");
  });

  test("Date/Time placeholders use the same localized formatter as list and detail cells", () => {
    const temporalFields = [
      { name: "dueDate", type: "Date", label: "Due", labelKey: "due", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"] },
      { name: "shiftStart", type: "Time", label: "Shift", labelKey: "shift", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"] },
    ] as unknown as ResourceField[];
    expect(plainTextTemplate("{$.dueDate}", { dueDate: "2026-11-30" }, { fields: temporalFields, locale: "en-US" })).toContain("2026");
    expect(plainTextTemplate("{$.shiftStart}", { shiftStart: "08:30:00" }, { fields: temporalFields, locale: "zh-CN" })).toBe("08:30:00");
    // Unparsable values fall back to the raw stored string instead of disappearing.
    expect(plainTextTemplate("{$.dueDate}", { dueDate: "not-a-date" }, { fields: temporalFields, locale: "en-US" })).toBe("not-a-date");
  });
});
`,
    ...renderExportTestFiles(),
    "web/tests/data-provider.test.ts": `import { describe, expect, test } from "bun:test";\nimport { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";\nconst requests: Array<{ url: string; method: string; body?: string }> = [];\nconst fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); const method = init?.method ?? "GET"; requests.push({ url, method, body: init?.body?.toString() }); const body = method === "GET" && url.includes("?") ? { data: [{ id: "one" }], total: 1 } : method === "DELETE" && url.includes("ids=") ? [{ id: "one" }] : { id: "one" }; return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;\ndescribe("same-origin Refine provider", () => { test("maps list and mutations", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 } }); await provider.getOne({ resource: "products", id: "one" }); await provider.create({ resource: "products", variables: { title: "New" } }); await provider.update({ resource: "products", id: "one", variables: { title: "Updated" } }); await provider.deleteOne({ resource: "products", id: "one" }); await provider.deleteMany?.({ resource: "products", ids: ["one", "two"] }); expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "PATCH", "DELETE", "DELETE"]); }); test("encodes table query state", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 3, pageSize: 10 }, sorters: [{ field: "name", order: "desc" }], filters: [{ field: "__search", operator: "contains", value: "phone" }, { field: "status", operator: "eq", value: "approved" }] }); const url = new URL(requests[0]!.url, "http://localhost"); expect(url.searchParams.get("page")).toBe("3"); expect(url.searchParams.get("pageSize")).toBe("10"); expect(url.searchParams.get("sort")).toBe("name"); expect(url.searchParams.get("order")).toBe("desc"); expect(url.searchParams.get("search")).toBe("phone"); expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual([{ field: "status", operator: "eq", value: "approved" }]); }); test("maps GraphQL list variables", async () => { requests.length = 0; const provider = createGraphQLDataProvider(async (input, init) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() }); return new Response(JSON.stringify({ data: { products: { items: [{ id: "one" }], total: 1 } } }), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 }, sorters: [{ field: "name", order: "desc" }] }); expect(result.total).toBe(1); const payload = JSON.parse(requests[0]!.body ?? "{}"); expect(payload.variables).toEqual({ page: 2, pageSize: 5, search: undefined, sort: "name", order: "desc", filters: [] }); }); test("batches getMany ids into one list request", async () => { requests.length = 0; const provider = createDataProvider(async (input) => { requests.push({ url: String(input), method: "GET" }); return Response.json({ data: [{ id: "a" }, { id: "b" }], total: 2 }); }); const result = await provider.getMany?.({ resource: "products", ids: ["a", "b", "a", ""] }); expect(result?.data).toEqual([{ id: "a" }, { id: "b" }]); expect(requests).toHaveLength(1); const url = new URL(requests[0]!.url, "http://localhost"); expect(url.searchParams.get("page")).toBe("1"); expect(url.searchParams.get("pageSize")).toBe("2"); expect(JSON.parse(url.searchParams.get("filters") ?? "[]")).toEqual([{ field: "id", operator: "in", value: "a,b" }]); }); test("coalesces identical getMany id sets into one network request", async () => { requests.length = 0; let calls = 0; const provider = createDataProvider(async (input) => { calls += 1; requests.push({ url: String(input), method: "GET" }); return Response.json({ data: [{ id: "a" }], total: 1 }); }); const [first, second] = await Promise.all([provider.getMany?.({ resource: ${JSON.stringify(database.entities[0]!.name)}, ids: ["7"] }), provider.getMany?.({ resource: ${JSON.stringify(database.entities[0]!.name)}, ids: ["7"] })]); expect(first?.data).toEqual([{ id: "a" }]); expect(second?.data).toEqual([{ id: "a" }]); await provider.getMany?.({ resource: ${JSON.stringify(database.entities[0]!.name)}, ids: ["7"] }); expect(calls).toBe(1); await provider.getMany?.({ resource: ${JSON.stringify(database.entities[0]!.name)}, ids: ["8"] }); expect(calls).toBe(2); }); test("getMany skips empty ids, caps and chunks large batches", async () => { requests.length = 0; const provider = createDataProvider(async (input) => { requests.push({ url: String(input), method: "GET" }); return Response.json({ data: [{ id: "x" }], total: 1 }); }); expect(await provider.getMany?.({ resource: "products", ids: [] })).toEqual({ data: [] }); expect(requests).toHaveLength(0); const manyIds = Array.from({ length: 250 }, (_, index) => "id-" + index); const batched = await provider.getMany?.({ resource: "products", ids: manyIds }); expect(batched?.data).toEqual([{ id: "x" }, { id: "x" }]); const pages = requests.map((request) => new URL(request.url, "http://localhost")); expect(pages.map((url) => url.searchParams.get("pageSize"))).toEqual(["100", "100"]); expect(pages.every((url) => JSON.parse(url.searchParams.get("filters") ?? "[]")[0].operator === "in")).toBe(true); await expect(provider.getMany?.({ resource: "../secrets", ids: ["x"] })).rejects.toThrow("Unknown resource"); }); test("GraphQL getMany batches ids into one list query", async () => { requests.length = 0; const provider = createGraphQLDataProvider(async (input, init) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() }); return new Response(JSON.stringify({ data: { ${JSON.stringify(database.entities[0]!.name)}: { items: [{ id: "a" }, { id: "b" }], total: 2 } } }), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await provider.getMany?.({ resource: "products", ids: ["a", "b"] }); expect(result?.data).toEqual([{ id: "a" }, { id: "b" }]); const payload = JSON.parse(requests[0]!.body ?? "{}"); expect(payload.variables).toEqual({ page: 1, pageSize: 2, filters: [{ field: "id", operator: "in", value: "a,b" }] }); }); test("rejects unknown resources", () => { const provider = createDataProvider(fetcher); expect(() => provider.getList({ resource: "../secrets" })).toThrow("Unknown resource"); }); });\n`.replaceAll('"products"', JSON.stringify(database.entities[0]!.tableName)).replace("data: { products:", `data: { ${database.entities[0]!.name}:`),
  };
  if (usesOidcAuth) generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace('  route("auth/login", "./routes/login.tsx"),', '  route("auth/login", "./routes/login.tsx"),\n  route("auth/callback", "./routes/auth-callback.tsx"),');
  if (actionDefinitions.length) {
    generated["web/app/routes/list.tsx"] = generated["web/app/routes/list.tsx"]!
      .replace('import { downloadFile } from "../hooks/download-file";', 'import { downloadFile } from "../hooks/download-file";\nimport { BatchBusinessActions, BusinessActions } from "../components/business-actions";')
      .replace('  </Space> });', '    <BusinessActions resource={resource.name} placement="list" record={record} />\n  </Space> });');
    if (actionDefinitions.some((action) => action.batch)) {
      generated["web/app/routes/list.tsx"] = generated["web/app/routes/list.tsx"]!
        .replace('    {!resource.readOnly && deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm', '    {selectedRowKeys.length > 0 && <BatchBusinessActions resource={resource.name} recordIds={selectedRowKeys.map(String)} onComplete={() => setSelectedRowKeys([])} />}\n    {!resource.readOnly && deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm')
        .replace(' rowSelection={!resource.readOnly && deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined}', ' rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}');
    }
    const manualActions = actionDefinitions.filter((action): action is GeneratedAction & { target: Extract<GeneratedAction["target"], { kind: "navigate" }> } => action.target.kind === "navigate");
    if (manualActions.length) {
      const routeLines = manualActions.map((action) => `  route(${JSON.stringify(action.target.path.slice(1))}, ${JSON.stringify(`./routes/actions/${action.name}.tsx`)}),`).join("\n");
      generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace('  layout("./routes/guard-list.tsx", [route(":resource", "./routes/list.tsx")]),', `${routeLines}\n  layout("./routes/guard-list.tsx", [route(":resource", "./routes/list.tsx")]),`);
      for (const action of manualActions) {
        generated[`web/app/routes/actions/${action.name}.tsx`] = `import { CanAccess } from "@refinedev/core";\nimport { Result } from "antd";\nimport { useParams } from "react-router";\nimport ManualPage from "../../extensions/${action.name}";\n\nexport default function QiyProtectedActionPage() { const { id } = useParams(); return <CanAccess resource=${JSON.stringify(action.resource)} action=${JSON.stringify(action.name)} params={{ id }} fallback={<Result status="403" title="403" />}><ManualPage /></CanAccess>; }\n`;
        generated[`web/app/extensions/${action.name}.tsx`] = `import { useTranslation } from "@refinedev/core";\nimport { Button, Card, Typography } from "antd";\nimport { Link, useParams } from "react-router";\n\nexport default function QiyManualActionPage() { const { id } = useParams(); const { translate } = useTranslation(); return <Card title=${JSON.stringify(action.label)}><Typography.Paragraph>{${action.target.commentKey ? `translate(${JSON.stringify(action.target.commentKey)}, {}, ${JSON.stringify(action.target.comment)})` : JSON.stringify(action.target.comment)}}</Typography.Paragraph><Typography.Text type="secondary">Resource ID: {id}</Typography.Text><div style={{ marginTop: 16 }}><Link to={${JSON.stringify(`/${action.resource}/`)} + encodeURIComponent(id ?? "")}><Button>{translate("buttons.list", {}, "Back")}</Button></Link></div></Card>; }\n`;
      }
    }
    const commandAction = actionDefinitions.find((action) => action.target.kind === "dataflow");
    const conditionalAction = actionDefinitions.find((action) => action.condition);
    if (commandAction?.target.kind === "dataflow") {
      const commandPayload = commandAction.batch
        ? { items: [{ [commandAction.target.idInput]: "record-1" }, { [commandAction.target.idInput]: "record-2" }] }
        : { [commandAction.target.idInput]: "record-1" };
      generated["web/tests/actions.test.ts"] = `import { expect, test } from "bun:test";\nimport { actionMatchesRecord, qiyActions } from "../app/actions";\nimport { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";\n\ntest("declared actions preserve placement and targets", () => { expect(qiyActions.find((action) => action.name === ${JSON.stringify(commandAction.name)})?.placements).toEqual(${JSON.stringify(commandAction.placements)}); });\n${conditionalAction?.condition ? `test("action conditions fail closed against the current record", () => { const action = qiyActions.find((candidate) => candidate.name === ${JSON.stringify(conditionalAction.name)})!; expect(actionMatchesRecord(action, { ${JSON.stringify(conditionalAction.condition.field)}: ${JSON.stringify(conditionalAction.condition.operator === "in" ? conditionalAction.condition.values[0] : conditionalAction.condition.value)} })).toBe(${conditionalAction.condition.operator !== "!="}); expect(actionMatchesRecord(action, { ${JSON.stringify(conditionalAction.condition.field)}: "__different__" })).toBe(${conditionalAction.condition.operator === "!="}); expect(actionMatchesRecord(action, {})).toBe(false); });\n` : ""}for (const [name, createProvider] of [["REST", createDataProvider], ["GraphQL", createGraphQLDataProvider]] as const) test(name + " ${commandAction.batch ? "batch " : ""}dataflow command sends JSON values and rejects undeclared commands", async () => { const requests: Array<{ url: string; init?: RequestInit }> = []; const provider = createProvider(async (url, init) => { requests.push({ url: String(url), init }); return Response.json(${commandAction.batch ? "[]" : '{ id: "record-1" }'}); }); await provider.custom?.({ url: ${JSON.stringify(commandAction.target.url)}, method: "post", payload: ${JSON.stringify(commandPayload)} }); expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(${JSON.stringify(commandPayload)}); expect((requests[0]?.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json"); await expect(provider.custom?.({ url: "/api/v1/commands/not-declared", method: "post", payload: {} })).rejects.toThrow("Unknown command"); });\n`;
    }
  }
  generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace("__QIY_TREE_ROUTE__", `${Object.keys(treeEntities).length ? '  route(":resource/tree", "./routes/tree.tsx"),\n' : ""}${hasSoftDelete ? '  route(":resource/trash", "./routes/trash.tsx"),\n' : ""}`);
  if (hasSoftDelete) generated["web/app/routes/trash.tsx"] = renderTrashPage();
  if (options.readOnly) {
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!
      .replace('      create: `/${resource.name}/new`,\n', "")
      .replace('      edit: `/${resource.name}/:id/edit`,\n', "");
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!
      .replace('  layout("./routes/guard-create.tsx", [route(":resource/new", "./routes/create.tsx")]),\n', "")
      .replace('  layout("./routes/guard-edit.tsx", [route(":resource/:id/edit", "./routes/edit.tsx")]),\n', "");
    let list = generated["web/app/routes/list.tsx"]!;
    // Read-only host integrations keep local saved views but must not offer delete.
    list = list.replace(/\n\s*\{canDeleteView\(\{ kind, mine \}\) && <span[\s\S]*?<\/span>\}/, "");
    list = list.replace(/\{!resource\.readOnly && <Upload[\s\S]*?<\/Upload>\}/, "");
    for (const [from, to] of [
      ['import { useCan, useDeleteMany, useGetIdentity, useNotification, useTranslation } from "@refinedev/core";', 'import { useGetIdentity, useNotification, useTranslation } from "@refinedev/core";'],
      ['import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";', 'import { List, ShowButton, useTable } from "@refinedev/antd";'],
      ['import { DeleteOutlined, DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";', 'import { DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";'],
      ['import { Alert, Button, Checkbox, Dropdown, Input, Popconfirm, Popover, Select, Space, Table, Tag, Typography, Upload } from "antd";', 'import { Alert, Button, Checkbox, Dropdown, Input, Popover, Select, Space, Table, Tag, Typography } from "antd";'],
      ['  const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);\n', ""],
      ['  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });\n', ""],
      ['    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />\n', ""],
      ['    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />\n', ""],
      ['  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };\n', ""],
      ['{!resource.readOnly && <CreateButton resource={resource.name}>{translate("qiy.createResource", { resource: singular }, singular)}</CreateButton>}', ""],
      ['    {!resource.readOnly && deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}\n', ""],
      [' rowSelection={!resource.readOnly && deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined}', ""],
    ] as const) list = list.replace(from, to);
    if (/useDelete|useDeleteMany|deletePermission|CreateButton|EditButton|DeleteButton|selectedRowKeys|Popconfirm|DeleteOutlined|routes\/(create|edit)/.test(list)) {
      throw new Error("Could not safely apply read-only integration UI policy");
    }
    generated["web/app/routes/list.tsx"] = list;
    generated["web/app/routes/show.tsx"] = generated["web/app/routes/show.tsx"]!
      // Read-only integrations never offer an edit form; the show page drops the
      // edit button but keeps the shared `RecordDetails` body.
      .replace('import { useOne, useGetIdentity, useTranslation, CanAccess } from "@refinedev/core";', 'import { useOne, useGetIdentity, useTranslation } from "@refinedev/core";')
      .replace('import { EditButton, ListButton, Show } from "@refinedev/antd";', 'import { ListButton, Show } from "@refinedev/antd";')
      .replace('{!resource.readOnly && <CanAccess resource={resource.name} action="edit"><EditButton resource={resource.name} recordItemId={id}>{t(locale, "edit")}</EditButton></CanAccess>}', "");
    for (const path of ["web/app/routes/create.tsx", "web/app/routes/edit.tsx", "web/app/routes/guard-create.tsx", "web/app/routes/guard-edit.tsx", "web/app/components/resource-form.tsx"]) delete generated[path];
  }
  const localizedFailure = (options.dataflows ?? []).flatMap((flow) => flow.steps.flatMap((step) => step.actions.flatMap((action) => action.kind === "require" && action.errorKey ? [{ flow: flow.name, error: action.error, errorKey: action.errorKey }] : [])))[0];
  if (localizedFailure && options.messages) {
    generated["web/tests/api-error.test.ts"] = `import { expect, test } from "bun:test";
import { qiyApiError } from "../app/api-error";
import { createDataProvider } from "../app/data-provider";
const failure = ${JSON.stringify({ error: localizedFailure.error, errorKey: localizedFailure.errorKey })};
test("translates declared business errors and keeps status and key", () => {
${Object.entries(options.messages.locales).map(([locale, entries]) => `  expect(qiyApiError(failure, 409, ${JSON.stringify(locale)})).toMatchObject({ message: ${JSON.stringify(entries[localizedFailure.errorKey] ?? localizedFailure.error)}, statusCode: 409, errorKey: failure.errorKey });`).join("\n")}
  expect(qiyApiError({ error: "fallback", errorKey: "missing" }, 409, "zh-CN").message).toBe("fallback");
  expect(qiyApiError({ error: "literal" }, 409, "zh-CN").message).toBe("literal");
});
test("Refine custom command preserves the localized API error contract", async () => {
  const provider = createDataProvider(async () => Response.json(failure, { status: 409 }));
  await expect(provider.custom!({ url: ${JSON.stringify(`/api/v1/commands/${localizedFailure.flow}`)}, method: "post", payload: {} })).rejects.toMatchObject({ message: qiyApiError(failure, 409).message, statusCode: 409, errorKey: failure.errorKey });
});
`;
  }
  if (options.messages) {
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!.replace('lang="zh-CN"', `lang=${JSON.stringify(options.messages.defaultLocale)}`);
    generated["web/tests/project-messages.test.ts"] = `import { expect, test } from "bun:test";
import { createI18nProvider, languageOptions, supportedLocales, resolveLocale, getAntdLocale, t } from "../app/i18n";
import { defaultMessageLocale, projectMessage } from "../app/messages";
test("switches model descriptions and falls back to the configured default locale", () => {
${Object.entries(options.messages.locales).flatMap(([locale, entries]) => Object.entries(entries).map(([key, message]) => `  expect(createI18nProvider(${JSON.stringify(locale)}).translate(${JSON.stringify(key)})).toBe(${JSON.stringify(message)});`)).join("\n")}
${Object.entries(options.messages.locales[options.messages.defaultLocale]!).map(([key, message]) => `  expect(projectMessage(${JSON.stringify(options.messages!.defaultLocale === "en-US" ? "zh-CN" : "en-US")}, ${JSON.stringify(key)})).toBe(${JSON.stringify(options.messages!.locales[options.messages!.defaultLocale === "en-US" ? "zh-CN" : "en-US"]?.[key] ?? message)});`).join("\n")}
  expect(projectMessage("en-US", "__proto__")).toBeUndefined();
  expect(projectMessage("zh-CN", "constructor")).toBeUndefined();
  expect(createI18nProvider("en-US").translate("constructor")).toBe("constructor");
  expect(createI18nProvider("zh-CN").translate("__proto__", {}, "Fallback")).toBe("Fallback");
});
test("switches declared locales, configures components and refuses undeclared locales", async () => {
  let selected = defaultMessageLocale;
  const provider = createI18nProvider(defaultMessageLocale, (next) => { selected = next; });
  for (const locale of supportedLocales) {
    await provider.changeLocale(locale);
    expect(selected).toBe(locale);
    expect(provider.getLocale()).toBe(locale);
    expect(languageOptions.some((option) => option.value === locale && option.label.length > 0)).toBe(true);
    expect(getAntdLocale(locale)).toBeDefined();
    expect(t(locale, "new")).toBe(projectMessage(locale, "qiy.new") ?? (locale === "zh-CN" ? "新建" : "New"));
  }
  await expect(provider.changeLocale("not-a-declared-locale")).rejects.toThrow("Unsupported interface locale");
  expect(resolveLocale("not-a-declared-locale")).toBe(defaultMessageLocale);
  expect(createI18nProvider("__proto__").translate("constructor")).toBe("constructor");
});
${Object.entries(options.messages.locales).flatMap(([locale, entries]) => Object.keys(entries).filter((key) => key.endsWith("_other") && Object.hasOwn(entries, key.slice(0, -6) + "_one")).map((key) => {
  const base = key.slice(0, -6);
  return `test(${JSON.stringify("selects localized plural forms for " + locale + " " + base)}, () => {\n  const provider = createI18nProvider(${JSON.stringify(locale)});\n${[1, 2].map((count) => {
    const category = new Intl.PluralRules(locale).select(count);
    const message = entries[base + "_" + category] ?? entries[key]!;
    return `  expect(provider.translate(${JSON.stringify(base)}, { count: ${count} })).toBe(${JSON.stringify(message.replaceAll("{{count}}", String(count)))});`;
  }).join("\n")}\n});`;
})).join("\n")}
`;
  }
  const componentLocales: Record<string, string> = { "ja-JP": "ja_JP", "ko-KR": "ko_KR", "fr-FR": "fr_FR", "de-DE": "de_DE", "es-ES": "es_ES", "pt-BR": "pt_BR", "ru-RU": "ru_RU", "ar-EG": "ar_EG", "hi-IN": "hi_IN", "it-IT": "it_IT", "zh-TW": "zh_TW" };
  const extraLocales = Object.keys(options.messages?.locales ?? {}).filter((locale) => Object.hasOwn(componentLocales, locale));
  generated["web/app/i18n.ts"] = generated["web/app/i18n.ts"]!
    .replace('import enUS from "antd/locale/en_US";', `import enUS from "antd/locale/en_US";\n${extraLocales.map((locale, index) => `import extraLocale${index} from "antd/locale/${componentLocales[locale]}";`).join("\n")}`)
    .replace('"en-US": enUS };', `"en-US": enUS${extraLocales.map((locale, index) => `, ${JSON.stringify(locale)}: extraLocale${index}`).join("")} };`);
  for (const path of Object.keys(generated)) {
    if (!path.startsWith("web/app/")) continue;
    // Templates already resolve every locale through resolveLocale; keeps older
    // inlined template snapshots working when they still hardcode en-US/zh-CN.
    generated[path] = generated[path]!.replaceAll('getLocale() === "en-US" ? "en-US" : "zh-CN"', 'resolveLocale(getLocale())');
    if (generated[path]!.includes("resolveLocale(getLocale())")) generated[path] = generated[path]!.replace('import { t, type QiyLocale }', 'import { t, resolveLocale, type QiyLocale }');
  }
  if (options.auth) {
    const userTable = database.entities.find((entity) => entity.name === options.auth!.userEntity)!.tableName;
    generated["web/app/auth.ts"] = generated["web/app/auth.ts"]!
      .replace('resource === "users"', `resource === ${JSON.stringify(userTable)}`)
      .replace('if (access === "full")', 'if (action === "audit") return { can: access === "full" }; if (access === "full")');
    generated["web/tests/auth.test.ts"] = generated["web/tests/auth.test.ts"]!.replaceAll('resource: "users"', `resource: ${JSON.stringify(userTable)}`).replaceAll('resource === "users"', `resource === ${JSON.stringify(userTable)}`);
    generated["web/tests/auth.test.ts"] += `
test("fetches the identity once per access token, even for concurrent guards", async () => {
  tokens.set("qiy.access_token", "identity-cache-token");
  let calls = 0;
  const originalFetchImpl = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/auth/me")) calls += 1;
    return originalFetchImpl(input, init);
  }) as typeof fetch;
  try {
    await Promise.all([
      qiyAuthProvider.getIdentity?.({}),
      qiyAuthProvider.getIdentity?.({}),
      qiyAccessControlProvider.can({ resource: ${JSON.stringify(userTable)}, action: "list" }),
      qiyAccessControlProvider.can({ resource: ${JSON.stringify(userTable)}, action: "create" }),
    ]);
    expect(calls).toBe(1);
    await qiyAuthProvider.getIdentity?.({});
    expect(calls).toBe(1);
    tokens.set("qiy.access_token", "identity-cache-token-2");
    await qiyAuthProvider.getIdentity?.({});
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetchImpl;
    tokens.clear();
  }
});
`;
    generated["web/app/root.tsx"] = 'import { auditLogProvider } from "./providers/audit-log-provider";\n' + generated["web/app/root.tsx"]!.replace("authProvider={qiyAuthProvider}", "auditLogProvider={auditLogProvider} authProvider={qiyAuthProvider}").replace("meta: { label: modelLabel(resource.pluralKey", "meta: { audit: [], label: modelLabel(resource.pluralKey");
    generated["web/app/routes/show.tsx"] = 'import { AuditHistory } from "../components/audit-history";\n' + generated["web/app/routes/show.tsx"]!.replace('</Show>;', '{id && <CanAccess resource={resource.name} action="audit"><AuditHistory resource={resource.name} recordId={id} /></CanAccess>}</Show>;');
    generated["web/app/providers/audit-log-provider.ts"] = `import type { AuditLogProvider } from "@refinedev/core";
import { qiyAuthToken } from "../auth";
import { resourceNames } from "../resources";

export function createAuditLogProvider(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): AuditLogProvider {
  return {
    get: async ({ resource, meta, action, author }) => {
      if (!(resourceNames as readonly string[]).includes(resource)) throw new Error("Unknown audit resource");
      const params = new URLSearchParams({ resource, page: String(meta?.page ?? 1), pageSize: String(meta?.pageSize ?? 20) });
      if (meta?.id !== undefined) params.set("resourceId", String(meta.id));
      if (action) params.set("action", ({ create: resource + ".created", update: resource + ".updated", delete: resource + ".deleted" } as Record<string, string>)[action] ?? action);
      if (author?.id !== undefined) params.set("actorId", String(author.id));
      const token = qiyAuthToken();
      const response = await fetcher("/api/v1/audit-logs/?" + params, { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error ?? "Audit request failed"), { statusCode: response.status });
      return body;
    },
    create: async () => { throw new Error("Audit events are written in server transactions; client writes are disabled"); },
    update: async () => { throw new Error("Authoritative audit history is immutable"); },
  };
}
export const auditLogProvider = createAuditLogProvider();
`;
    generated["web/tests/audit-provider.test.ts"] = `import { expect, test } from "bun:test";
import { createAuditLogProvider } from "../app/providers/audit-log-provider";
import { qiyAuthProvider } from "../app/auth";

test("audit provider maps Refine filters, propagates authentication errors and disallows writes", async () => {
  let requested = "";
  const provider = createAuditLogProvider(async (input) => { requested = String(input); return Response.json({ data: [], total: 0 }); });
  const resource = ${JSON.stringify(database.entities[0]!.tableName)};
  expect(await provider.get({ resource, action: "update", meta: { id: "record", page: 2 }, author: { id: "actor" } })).toEqual({ data: [], total: 0 });
  const query = new URL(requested, "http://localhost").searchParams;
  expect(query.get("resourceId")).toBe("record"); expect(query.get("action")).toBe(resource + ".updated"); expect(query.get("page")).toBe("2"); expect(query.get("actorId")).toBe("actor");
  await expect(provider.create({ resource, action: "create", meta: {} })).rejects.toThrow("client writes are disabled");
  await expect(provider.update({ id: "event", name: "forged" })).rejects.toThrow("immutable");
  await expect(provider.get({ resource: "unknown" })).rejects.toThrow("Unknown audit resource");
  const failing = createAuditLogProvider(async () => Response.json({ error: "Expired" }, { status: 401 }));
  try { await failing.get({ resource }); throw new Error("Expected rejection"); } catch (error) { expect(error).toMatchObject({ statusCode: 401, message: "Expired" }); expect(await qiyAuthProvider.onError(error)).toMatchObject({ logout: true }); }
  expect(await qiyAuthProvider.onError({ statusCode: 403 })).toEqual({});
});
`;
    generated["web/app/components/audit-history.tsx"] = `import { useLogList, useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import { useState } from "react";

type AuditEntry = { id: string; action: string; createdAt: string; author: { id: string; name: string; deleted: boolean } | null };
export function AuditHistory({ resource, recordId }: { resource: string; recordId: string }) {
  const [page, setPage] = useState(1);
  const { translate } = useTranslation();
  const query = useLogList<{ data: AuditEntry[]; total: number }>({ resource, meta: { id: recordId, page, pageSize: 10 } });
  return <Card title={translate("qiy.auditTitle", {}, "Audit history")} style={{ marginTop: 16 }}>{query.error ? <Alert type="error" message={query.error.message} /> : <Table<AuditEntry> rowKey="id" loading={query.isLoading} dataSource={query.data?.data ?? []} pagination={{ current: page, pageSize: 10, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[{ title: translate("qiy.auditAction", {}, "Action"), dataIndex: "action" }, { title: translate("qiy.auditAuthor", {}, "Author"), render: (_, row) => row.author?.name ?? translate("qiy.auditSystem", {}, "System") }, { title: translate("qiy.auditTime", {}, "Time"), dataIndex: "createdAt" }]} />}</Card>;
}
`;
  }
  if (usesRealtime) addRealtimeFiles(generated, usesGraphqlSubscriptions);
  if (multiProviderAuth) {
    generated["web/app/auth/oidc-multi.ts"] = renderMultiProviderWebClient();
    generated["web/app/routes/oauth-callback.tsx"] = 'export { default } from "./auth-callback";';
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  route("auth/login", "./routes/login.tsx"),',
      '  route("auth/login", "./routes/login.tsx"),\n  route("auth/callback", "./routes/auth-callback.tsx"),\n  route("oauth/*", "./routes/oauth-callback.tsx"),',
    );
    generated["web/app/routes/login.tsx"] = `import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "@refinedev/core";
import { beginProviderLogin, fetchAuthProviders, type QiyAuthProviderPublic } from "../auth/oidc-multi";

export default function Login() {
  const { translate } = useTranslation();
  const [providers, setProviders] = useState<QiyAuthProviderPublic[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) { setProviders(list); setLoading(false); } }).catch((caught: unknown) => { if (active) { setError(caught instanceof Error ? caught.message : String(caught)); setLoading(false); } }); return () => { active = false; }; }, []);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}>
    <Card style={{ width: 420 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Qiy Admin</Typography.Title>
        <Typography.Text type="secondary">{translate("qiy.multiProviderHint", {}, "Choose an identity provider to sign in.")}</Typography.Text>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {loading ? <Spin /> : null}
        <Space direction="vertical" style={{ width: "100%" }}>
          {providers.map((provider) => <Button key={provider.id} block size="large" onClick={() => void beginProviderLogin(provider)}>{provider.label}</Button>)}
        </Space>
        {!loading && providers.length === 0 && !error ? <Alert type="warning" showIcon message={translate("qiy.noProviderConfigured", {}, "No identity provider is configured on the server")} /> : null}
      </Space>
    </Card>
  </main>;
}
`;
    generated["web/app/routes/auth-callback.tsx"] = `import { Alert, Card, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { completeProviderLogin } from "../auth/oidc-multi";

export default function AuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (started.current) return; started.current = true; void completeProviderLogin(new URL(window.location.href)).then((target) => navigate(target || "/", { replace: true })).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))); }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card>{error ? <Alert type="error" showIcon message={error} /> : <Spin />}</Card></main>;
}
`;
  }
  if (hybridAuth) {
    generated["web/app/auth/oidc-multi.ts"] = renderHybridWebClient();
    generated["web/app/auth/account.ts"] = renderAccountWebClient();
    generated["web/app/routes/oauth-callback.tsx"] = 'export { default } from "./auth-callback";';
    generated["web/app/routes/auth-callback.tsx"] = `import { Alert, Card, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@refinedev/core";
import { completeProviderCallback } from "../auth/oidc-multi";

/** Finishes a provider sign-in: onboarding, linked provider or a normal session. */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const started = useRef(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // No "active" cleanup guard here: React StrictMode runs the cleanup between
    // the double-invoked effects, and the second pass is skipped by the ref, so an
    // active flag would silently swallow the navigation and leave the spinner up.
    void completeProviderCallback(new URL(window.location.href))
      .then((target) => navigate(target, { replace: true }))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>{translate("qiy.completingSignIn", {}, "Completing sign-in…")}</Typography.Paragraph></>}</Card></main>;
}
`;
    generated["web/app/routes/auth-onboarding.tsx"] = renderOnboardingRoute({
      usernameLabel: onboardingUsernameLabel,
      hasEmailField: Boolean(onboardingEmailField),
    });
    generated["web/app/routes/profile.tsx"] = renderProfileRoute({ hasProviderBinding: true, ...(authRoleEnumName && { roleEnumName: authRoleEnumName }) });
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  route("auth/login", "./routes/login.tsx"),',
      '  route("auth/login", "./routes/login.tsx"),\n  route("auth/callback", "./routes/auth-callback.tsx"),\n  route("oauth/*", "./routes/oauth-callback.tsx"),\n  route("auth/onboarding", "./routes/auth-onboarding.tsx"),\n  route("profile", "./routes/profile.tsx"),',
    );
  } else if (hasLocalAuth) {
    generated["web/app/auth/account.ts"] = renderAccountWebClient();
    generated["web/app/routes/profile.tsx"] = renderProfileRoute({ hasProviderBinding: false, ...(authRoleEnumName && { roleEnumName: authRoleEnumName }) });
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  index("./routes/home.tsx"),',
      '  index("./routes/home.tsx"),\n  route("profile", "./routes/profile.tsx"),',
    );
  }
  if (hasLocalAuth) {
    // The profile page is reachable from the app header for every password-based
    // account, including local-only projects without OAuth providers.
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!
      .replace('import { Select, Space, Typography, theme } from "antd";', 'import { Button, Select, Space, Typography, theme } from "antd";')
      .replace('import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";', 'import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";')
      .replace("    <QiyThemeControls />", '    <Link to="/profile"><Button type="link">{translate("qiy.profile", {}, "Profile")}</Button></Link>\n    <QiyThemeControls />');
  }

  // System administration: 功能总览 / API 文档 / 访问密钥 pages, gated by features.
  const features = options.features ?? { overview: true, apiDocs: false, apiKeys: false };
  const apiDocsFeature = Boolean(features.apiDocs);
  const apiKeysFeature = Boolean(features.apiKeys);
  const overviewFlag = features.overview !== false;
  const overviewPageEnabled = overviewFlag && (apiDocsFeature || apiKeysFeature);
  const docsHelpersEnabled = overviewPageEnabled || apiDocsFeature;
  generated["web/app/features.ts"] = renderWebFeaturesModule(overviewPageEnabled, apiDocsFeature, apiKeysFeature);
  if (overviewPageEnabled || apiDocsFeature || apiKeysFeature) generated["web/tests/features.test.ts"] = renderWebFeaturesTest(overviewPageEnabled, apiDocsFeature, apiKeysFeature);
  const routeLines: string[] = [];
  const webPackage = JSON.parse(generated["web/package.json"]!) as { dependencies: Record<string, string> };
  if (docsHelpersEnabled) generated["web/app/docs.ts"] = renderWebDocsModule(usesAuth);
  if (apiKeysFeature) generated["web/app/api-keys.ts"] = renderWebApiKeysModule();
  if (overviewPageEnabled) {
    generated["web/app/components/mermaid.tsx"] = renderWebMermaidComponent();
    generated["web/app/components/docs-page.tsx"] = renderWebDocsPageComponent();
    generated["web/app/routes/docs.tsx"] = renderWebDocsRoute();
    generated["web/tests/docs.test.ts"] = renderWebOverviewTest();
    generated["web/tests/docs-render.test.tsx"] = renderWebOverviewRenderTest();
    routeLines.push('  route("system/overview", "./routes/docs.tsx"),');
    // Mermaid is only used by the overview page's entity/dataflow diagrams.
    webPackage.dependencies.mermaid = "12.2.0";
    generated["web/package.json"] = `${JSON.stringify(webPackage, null, 2)}\n`;
  }
  if (apiDocsFeature) {
    generated["web/app/components/api-docs-page.tsx"] = renderWebApiDocsPageComponent();
    generated["web/app/routes/api-docs.tsx"] = renderWebApiDocsRoute(usesAuth);
    generated["web/tests/api-docs.test.ts"] = renderWebApiDocsTest();
    generated["web/tests/api-docs-render.test.tsx"] = renderWebApiDocsRenderTest();
    routeLines.push('  route("system/api-docs", "./routes/api-docs.tsx"),');
  }
  if (apiKeysFeature) {
    generated["web/app/components/api-keys-page.tsx"] = renderWebApiKeysPageComponent();
    generated["web/app/routes/api-keys.tsx"] = renderWebApiKeysRoute();
    generated["web/tests/api-keys.test.ts"] = renderWebApiKeysTest();
    generated["web/tests/api-keys-render.test.tsx"] = renderWebApiKeysRenderTest(apiDocsFeature);
    routeLines.push('  route("system/api-keys", "./routes/api-keys.tsx"),');
  }
  if (routeLines.length > 0) {
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  index("./routes/home.tsx"),',
      '  index("./routes/home.tsx"),\n' + routeLines.join("\n"),
    );
  }


  return generated;
}

/** Trash page for @softDelete resources: lists deleted rows and restores them. */
function renderTrashPage(): string {
  return `import { useCan, useNotification, useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Popconfirm, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { UndoOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { getResource } from "../resources";

function authHeaders(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function ResourceTrash() {
  const { resource: name } = useParams();
  const resource = getResource(name);
  const { translate } = useTranslation();
  const { open: notify } = useNotification();
  const { data: permission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource?.softDelete } });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState<string>();
  const load = useCallback(async () => {
    if (!resource?.softDelete || !permission?.can) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/v1/" + resource.name + "?deleted=true&page=" + page + "&pageSize=" + pageSize, { headers: authHeaders() });
      const body = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>>; total?: number; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "API error " + response.status);
      setRows(body?.data ?? []);
      setTotal(Number(body?.total ?? 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [resource, permission?.can, page, pageSize]);
  useEffect(() => { void load(); }, [load]);
  if (!resource?.softDelete) return <Alert type="error" message={translate("qiy.trashUnavailable", {}, "This resource has no trash")} />;
  if (permission && !permission.can) return <Alert type="error" message={translate("qiy.trashDenied", {}, "You cannot manage deleted records")} />;
  const restore = async (id: string) => {
    setRestoring(id);
    try {
      const response = await fetch("/api/v1/" + resource.name + "/" + encodeURIComponent(id) + "/restore", { method: "POST", headers: authHeaders() });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "API error " + response.status);
      notify?.({ type: "success", message: translate("qiy.restored", {}, "Record restored") });
      await load();
    } catch (cause) {
      notify?.({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setRestoring(undefined);
    }
  };
  const columns: ColumnsType<Record<string, unknown>> = [
    ...resource.fields.filter((field) => field.listVisible && field.type !== "Vector").map((field) => ({ title: translate(field.labelKey, {}, field.label), dataIndex: field.name, key: field.name, render: (value: unknown) => cellText(value) })),
    { title: translate("qiy.actions", {}, "Actions"), key: "actions", fixed: "right", render: (_value, record) => <Popconfirm title={translate("qiy.confirmRestore", {}, "Restore this record?")} onConfirm={() => void restore(String(record.id))}><Button icon={<UndoOutlined />} loading={restoring === String(record.id)}>{translate("qiy.restore", {}, "Restore")}</Button></Popconfirm> },
  ];
  const title = translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label));
  return <Card title={title + " - " + translate("qiy.trash", {}, "Trash")} extra={<Link to={"/" + resource.name}><Button>{translate("qiy.back", {}, "Back")}</Button></Link>}>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table<Record<string, unknown>> rowKey="id" loading={loading} dataSource={rows} columns={columns} scroll={{ x: "max-content" }} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }} />
  </Card>;
}
`;
}
