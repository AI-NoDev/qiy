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
});
