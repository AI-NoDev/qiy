const sandboxModel = await Bun.file("languages/qiy.sandbox/models/qiy.relations.mps").text();
const registry = sandboxModel.match(/<registry>[\s\S]*?<\/registry>/)?.[0];
if (!registry) throw new Error("MPS Relations model is missing its concept registry");

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

let nextId = 130000000000001;
function property(role: string, value: string): string {
  return `<property role="${role}" value="${xml(value)}" />`;
}

function node(concept: string, role: string, properties: Array<[string, string]>, children: string[] = []): string {
  const id = nextId++;
  const attributes = properties.map(([key, value]) => property(key, value)).join("");
  return `<node concept="${concept}" id="${id}" role="${role}">${attributes}${children.join("")}</node>`;
}

function field(name: string, type: string, options: { primaryKey?: boolean; nullable?: boolean; unique?: boolean; precision?: number; scale?: number; visible?: boolean; listVisible?: boolean; formVisible?: boolean; showVisible?: boolean; sortable?: boolean; filterable?: boolean; label?: string; icon?: string } = {}): string {
  const properties: Array<[string, string]> = [["TrG5h", name], ["qq", type]];
  if (options.primaryKey !== undefined) properties.push(["qt", String(options.primaryKey)]);
  if (options.nullable !== undefined) properties.push(["qs", String(options.nullable)]);
  if (options.unique !== undefined) properties.push(["qu", String(options.unique)]);
  if (options.precision !== undefined) properties.push(["qprecision", String(options.precision)]);
  if (options.scale !== undefined) properties.push(["qscale", String(options.scale)]);
  if (options.visible !== undefined) properties.push(["qvisible", String(options.visible)]);
  if (options.listVisible !== undefined) properties.push(["qlistVisible", String(options.listVisible)]);
  if (options.formVisible !== undefined) properties.push(["qformVisible", String(options.formVisible)]);
  if (options.showVisible !== undefined) properties.push(["qshowVisible", String(options.showVisible)]);
  if (options.sortable !== undefined) properties.push(["qsortable", String(options.sortable)]);
  if (options.filterable !== undefined) properties.push(["qfilterable", String(options.filterable)]);
  if (options.label !== undefined) properties.push(["qfieldLabel", options.label]);
  if (options.icon !== undefined) properties.push(["qfieldIcon", options.icon]);
  return node("qp", "qo", properties);
}

function entity(name: string, tableName: string, fields: string[]): string {
  return node("qk", "qe", [["TrG5h", name], ["ql", tableName]], fields);
}

const enumValue = (name: string, label: string, color: string, icon: string) => node("qenumValue", "qenumValues", [["TrG5h", name], ["qenumLabel", label], ["qenumColor", color], ["qenumIcon", icon]]);
const enumValues = [
  enumValue("draft", "草稿", "default", "EditOutlined"),
  enumValue("submitted", "已提交", "blue", "SendOutlined"),
  enumValue("approved", "已审批", "green", "CheckOutlined"),
  enumValue("shipped", "已出库", "cyan", "SendOutlined"),
  enumValue("cancelled", "已取消", "red", "CloseOutlined"),
];
const orderStatus = node("qenum", "qenums", [["TrG5h", "orderStatus"]], enumValues);
const userRole = node("qenum", "qenums", [["TrG5h", "userRole"]], [
  enumValue("admin", "管理员", "red", "SafetyOutlined"),
  enumValue("operator", "运营", "blue", "UserOutlined"),
  enumValue("viewer", "只读", "default", "EyeOutlined"),
]);
const database = node("qf", "qd", [["TrG5h", "main"], ["qg", "postgresql"], ["qh", "drizzle"]]);
const workflow = node("qworkflowConfig", "qworkflows", [["TrG5h", "orderInventory"]]);
const auth = node("qauthConfig", "qauth", [["qauthProvider", "oidc"], ["qauthUser", "users"], ["qauthSubject", "externalSubject"], ["qauthRole", "role"]]);
const menuGroups = [
  node("qmenuGroup", "qmenuGroups", [["TrG5h", "operations"], ["qmenuLabel", "业务运营"], ["qmenuIcon", "ShopOutlined"]]),
  node("qmenuGroup", "qmenuGroups", [["TrG5h", "sales"], ["qmenuLabel", "销售管理"], ["qmenuIcon", "ShoppingOutlined"], ["qmenuParent", "operations"]], [
    node("qmenuResource", "qmenuResources", [["qmenuResourceName", "orders"]]),
    node("qmenuResource", "qmenuResources", [["qmenuResourceName", "order_items"]]),
  ]),
  node("qmenuGroup", "qmenuGroups", [["TrG5h", "inventory"], ["qmenuLabel", "库存管理"], ["qmenuIcon", "InboxOutlined"], ["qmenuParent", "operations"]], [
    node("qmenuResource", "qmenuResources", [["qmenuResourceName", "inventory_items"]]),
  ]),
  node("qmenuGroup", "qmenuGroups", [["TrG5h", "administration"], ["qmenuLabel", "系统管理"], ["qmenuIcon", "SettingOutlined"]], [
    node("qmenuResource", "qmenuResources", [["qmenuResourceName", "users"]]),
  ]),
];
const dashboardMetrics = [
  node("qdashboardMetric", "qdashboards", [["TrG5h", "orderCount"], ["qmetricResource", "orders"], ["qmetricLabel", "订单总数"], ["qmetricIcon", "ShoppingOutlined"], ["qmetricSpan", "8"]]),
  node("qdashboardMetric", "qdashboards", [["TrG5h", "orderStatus"], ["qmetricResource", "orders"], ["qmetricLabel", "订单状态分布"], ["qmetricSpan", "12"], ["qmetricType", "distribution"], ["qmetricGroupBy", "status"]]),
  node("qdashboardMetric", "qdashboards", [["TrG5h", "orderTrend"], ["qmetricResource", "orders"], ["qmetricLabel", "近 30 天订单趋势"], ["qmetricSpan", "24"], ["qmetricType", "trend"], ["qmetricGroupBy", "createdAt"], ["qmetricDays", "30"]]),
];
const users = entity("users", "users", [
  field("id", "UUID", { primaryKey: true }),
  field("email", "Text", { unique: true }),
  field("displayName", "Text"),
  field("externalSubject", "Text", { unique: true, listVisible: false, showVisible: false }),
  field("role", "userRole"),
]);
const orders = entity("orders", "orders", [
  field("id", "UUID", { primaryKey: true }),
  field("orderNumber", "Text", { unique: true }),
  field("status", "orderStatus", { label: "订单状态", icon: "TagsOutlined", listVisible: false, sortable: false, filterable: true }),
  field("totalAmount", "Money", { precision: 12, scale: 2 }),
  field("approvedBy", "UUID", { nullable: true, listVisible: false, formVisible: false, filterable: false }),
  field("createdAt", "DateTime"),
]);
const orderItems = entity("orderItems", "order_items", [
  field("id", "UUID", { primaryKey: true }),
  field("orderId", "UUID"),
  field("productId", "UUID"),
  field("quantity", "Integer"),
  field("unitPrice", "Money", { precision: 12, scale: 2 }),
]);
const inventoryItems = entity("inventoryItems", "inventory_items", [
  field("id", "UUID", { primaryKey: true }),
  field("productId", "UUID"),
  field("quantity", "Integer"),
  field("reservedQuantity", "Integer"),
]);

const relations = [
  node("qrelation", "qrelations", [["TrG5h", "orderItemOrder"], ["qfromEntity", "orderItems"], ["qfromField", "orderId"], ["qtoEntity", "orders"], ["qtoField", "id"], ["qcardinality", "one"]]),
  node("qrelation", "qrelations", [["TrG5h", "orderApprovedBy"], ["qfromEntity", "orders"], ["qfromField", "approvedBy"], ["qtoEntity", "users"], ["qtoField", "id"], ["qcardinality", "one"], ["qonDelete", "setNull"]]),
];
const application = node("qa", "", [["TrG5h", "qiy-erp-workflow"]], [database, workflow, orderStatus, userRole, auth, users, orders, orderItems, inventoryItems, ...relations, ...menuGroups, ...dashboardMetrics]);
const model = `<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:3f6e02b4-e533-4c1d-b886-8a1dc89c9489(qiy.erpworkflow)">
  <persistence version="9" />
  <languages><use id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy" version="0" /></languages>
  <imports />
  ${registry}
  ${application.replace(' role=""', "")}
</model>
`;

await Bun.write("languages/qiy.sandbox/models/qiy.erpworkflow.mps", model);
