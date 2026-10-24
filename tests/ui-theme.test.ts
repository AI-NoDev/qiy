import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = `qiy v0; application qiy-theme-demo {
  database sqlite {}
  ui {
    library antd;
    theme purple;
    themes purple, blue, green;
    colorMode system;
    allowThemeSwitch true;
    allowColorModeSwitch true;
  }
  entity products { field id UUID @id; field name Text; }
}`;

describe("Qiy UI themes", () => {
  test("round-trips the Ant Design theme configuration", () => {
    const project = parseQiyProject(source);
    expect(project.ui).toEqual({
      library: "antd",
      theme: "purple",
      themes: ["purple", "blue", "green"],
      colorMode: "system",
      allowThemeSwitch: true,
      allowColorModeSwitch: true,
    });
    expect(parseQiyProject(serializeQiyProject(project)).ui).toEqual(project.ui);
  });

  test("generates a persisted header theme selector and Ant Design adapter", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/app/ui/theme-config.ts"]).toContain('"theme": "purple"');
    expect(files["apps/web/app/ui/theme-config.ts"]).toContain('"green"');
    expect(files["apps/web/app/ui/index.tsx"]).toContain("antdTheme.darkAlgorithm");
    expect(files["apps/web/app/ui/index.tsx"]).toContain("prefers-color-scheme: dark");
    expect(files["apps/web/app/ui/index.tsx"]).toContain("qiy.ui.color-mode");
    expect(files["apps/web/app/root.tsx"]).toContain("<QiyThemeControls />");
    expect(files["apps/web/app/root.tsx"]).toContain('translate("qiy.language", {}, "Language")');
    expect(files["apps/web/app/root.tsx"]).toContain('className="qiy-header"');
    expect(files["apps/web/app/root.tsx"]).toContain('name: "qiy-overview"');
    expect(files["apps/web/app/root.tsx"]).toContain('list: "/"');
    expect(files["apps/web/app/root.tsx"]).toContain('resolveResourceIcon("DashboardOutlined")');
    expect(files["apps/web/app/routes/home.tsx"]).toContain("token.colorPrimary");
    expect(files["apps/web/app/routes/home.tsx"]).not.toContain('color: "#1677ff"');
    expect(files["apps/web/app/styles.css"]).toContain(".qiy-shell { height: 100dvh; overflow: hidden; }");
    expect(files["apps/web/app/styles.css"]).toContain(".qiy-shell .ant-layout-content");
  });

  test("uses Refine Ant Design CRUD shells before custom components", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/app/routes/list.tsx"]).toContain("CreateButton, DeleteButton, EditButton, List, ShowButton");
    expect(files["apps/web/app/routes/show.tsx"]).toContain("EditButton, ListButton, Show");
    expect(files["apps/web/app/components/resource-form.tsx"]).toContain("Create, Edit, useForm, useSelect");
    expect(JSON.parse(files["apps/web/package.json"]!).scripts.build).toBe("node build.mjs");
    expect(files["apps/web/build.mjs"]).toContain('require.resolve("@react-router/dev/package.json")');
    expect(files["apps/web/package.json"]).not.toContain("@refinedev/mui");
    expect(files["apps/web/package.json"]).not.toContain("@refinedev/mantine");
    expect(files["Dockerfile"]).toContain("COPY package.json turbo.json ./");
    expect(files["Dockerfile"]).not.toContain("COPY package.json bun.lock");
  });

  test("rejects unsupported libraries, theme keys and inconsistent defaults", () => {
    expect(() => parseQiyProject(source.replace("library antd", "library mui"))).toThrow("only antd is implemented");
    expect(() => parseQiyProject(source.replace("theme purple", "theme cyan"))).toThrow("Unsupported UI theme cyan");
    expect(() => parseQiyProject(source.replace("themes purple, blue, green", "themes blue, green"))).toThrow("must be included in themes");
    expect(() => parseQiyProject(source.replace("themes purple, blue, green", "themes purple, purple"))).toThrow("Duplicate UI theme purple");
  });
});
