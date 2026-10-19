import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = (annotations: string, type = "File") => `qiy v0; application upload-policy {
  database sqlite {}
  entity documents {
    field id UUID @id;
    field attachment ${type} ${annotations};
  }
}`;

describe("File upload policy", () => {
  test("supports multi-file Files fields with a JSON key array and a bounded REST/GraphQL contract", () => {
    const project = parseQiyProject(source('@upload(base64) @maxBytes(1024) @mime("application/pdf") @maxFiles(3)', "Files"));
    const field = project.database.entities[0]!.fields[1]!;
    expect(field).toMatchObject({ type: "Files", maxFiles: 3, maxBytes: 1024, uploadMode: "base64", mimeTypes: ["application/pdf"], sortable: false, filterable: false });
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);

    const files = generateProject(project.database, project.name);
    // One JSON column holds the key list; each upload still gets its own attachment row.
    expect(files["apps/server/src/schema.ts"]).toContain('"attachment": text("attachment", { mode: "json" }).$type<string[]>()');
    // The per-file upload policy now carries the real maxFiles instead of a hardcoded 1.
    expect(files["apps/server/src/storage/routes.ts"]).toContain('"maxFiles": 3');
    const routes = Object.entries(files).filter(([path]) => path.includes("/modules/") && path.endsWith(".routes.ts")).map(([, content]) => content).join("\n");
    expect(routes).toContain("t.Array(t.String({ minLength: 1, maxLength: 240 }), { minItems: 1, maxItems: 3 })");
    const graphql = files["apps/server/src/graphql.ts"]!;
    expect(graphql).toContain("[String!]");
    const resources = files["apps/web/app/resources.ts"]!;
    expect(resources).toContain('"maxFiles": 3');
    expect(resources).toContain('"type": "Files"');
  });

  test("rejects invalid Files declarations", () => {
    expect(() => parseQiyProject(source("@maxFiles(0)", "Files"))).toThrow("between 1 and 20");
    expect(() => parseQiyProject(source("@maxFiles(21)", "Files"))).toThrow("between 1 and 20");
    // A single File keeps one key; multi-file must use Files rather than a larger maxFiles.
    expect(() => parseQiyProject(source("@maxFiles(3)"))).toThrow("declare the field as Files");
    expect(() => parseQiyProject(source('@upload(binary)', "Text"))).toThrow("File and Files");
    expect(() => generateProject(parseQiyProject(source("@id", "Files")).database, "multi-file")).toThrow("Files cannot be a primary key");
    expect(() => generateProject(parseQiyProject(source("@unique", "Files")).database, "multi-file")).toThrow("Files cannot be unique");
  });

  test("round-trips explicit upload constraints and generates fail-closed policies", () => {
    const project = parseQiyProject(source('@upload(both) @maxBytes(10485760) @mime("application/pdf") @mime("image/*") @maxFiles(1)'));
    const field = project.database.entities[0]!.fields[1]!;
    expect(field).toMatchObject({
      uploadMode: "both",
      maxBytes: 10485760,
      mimeTypes: ["application/pdf", "image/*"],
      maxFiles: 1,
    });
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);

    const files = generateProject(project.database, project.name);
    const routes = files["apps/server/src/storage/routes.ts"]!;
    expect(routes).toContain('"documents.attachment"');
    expect(routes).toContain('"mode": "both"');
    expect(routes).toContain('"maxBytes": 10485760');
    expect(routes).toContain('"application/pdf"');
    expect(routes).toContain('"image/*"');
    expect(routes).toContain('throw new UploadFailure(400, "Unknown file field")');
    expect(routes).toContain('.post("/base64"');
  });

  test("rejects upload annotations on non-File fields", () => {
    for (const annotation of [
      "@upload(binary)",
      "@maxBytes(1024)",
      '@mime("text/plain")',
      "@maxFiles(1)",
    ]) expect(() => parseQiyProject(source(annotation, "Text"))).toThrow("File");
  });

  test("rejects invalid modes, sizes, MIME patterns, duplicates and multiple files", () => {
    expect(() => parseQiyProject(source("@upload(stream)"))).toThrow("binary, base64 or both");
    expect(() => parseQiyProject(source("@maxBytes(0)"))).toThrow("between 1 and 104857600");
    expect(() => parseQiyProject(source("@maxBytes(104857601)"))).toThrow("between 1 and 104857600");
    expect(() => parseQiyProject(source('@mime("not a mime")'))).toThrow("MIME");
    expect(() => parseQiyProject(source('@mime("application/pdf") @mime("application/pdf")'))).toThrow("Duplicate File MIME");
    expect(() => parseQiyProject(source("@maxFiles(2)"))).toThrow("support maxFiles(1)");
  });

  test("generates an object orphan scan next to the metadata cleanup", () => {
    const project = parseQiyProject(source('@upload(both) @maxBytes(1024)'));
    const files = generateProject(project.database, project.name);
    const adapter = files["apps/server/src/storage/index.ts"]!;
    // Both providers must be able to enumerate stored objects for the scan.
    expect(adapter).toContain("list(): Promise<string[]>");
    expect(adapter).toContain("async list()");
    expect(adapter).toContain("const walk = async (current: string)");
    expect(adapter).toContain("client.list({ prefix: \"\", maxKeys: 1000");
    expect(adapter).toContain("for (let page = 0; page < 20; page++)");
    const routes = files["apps/server/src/storage/routes.ts"]!;
    expect(routes).toContain("export async function scanOrphanAttachmentObjects(");
    // The scan reports both directions and never deletes by default.
    expect(routes).toContain("const dryRun = options.dryRun ?? true;");
    expect(routes).toContain("missingObjects");
    expect(routes).toContain("truncated");
    expect(routes).toContain("Attachment orphan scanning requires QIY_STORAGE_METADATA=database and DATABASE_URL");
    const cli = files["apps/server/src/storage/orphans.ts"]!;
    expect(cli).toContain('const dryRun = !Bun.argv.includes("--apply");');
    expect(cli).toContain("dry run: nothing was deleted");
    expect(cli).toContain("process.exit(1)");
    const packageJson = JSON.parse(files["apps/server/package.json"]!) as { scripts: Record<string, string> };
    expect(packageJson.scripts["attachments:orphans"]).toBe("bun src/storage/orphans.ts");
    expect(packageJson.scripts["attachments:cleanup"]).toBe("bun src/storage/cleanup.ts");
  });
});
