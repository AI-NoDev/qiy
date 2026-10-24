import { describe, expect, test } from "bun:test";
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
    expect(renderTemplate("{$.value}", { value: "a&b \"quoted\" 'single'" })).toBe("a&amp;b &quot;quoted&quot; &#39;single&#39;");
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
