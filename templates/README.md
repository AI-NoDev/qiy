# Qiy Admin Template

`admin/` is the stable Bun + Turborepo application scaffold. The generator copies its files into the output project, replacing only `__QIY_APP_NAME__` and `__QIY_FIRST_RESOURCE__` in the package metadata and generated README.

```text
admin/
├── package.json
├── turbo.json
└── apps/
    ├── server/    Bun + Elysia HTTP, Drizzle configuration
    └── web/       Refine + React Router SPA, generic CRUD UI
```

`tools/generate-project.ts` merges model-dependent files from the validated Database IR with the scaffold: Drizzle schema, resource definitions, Elysia app and resource modules, preview data and generated tests. The template owns the runtime shell, configuration, plugin/hook extension points and reusable UI; Qiy owns data-driven slices. A generated project has no runtime dependency on this repository or its template.

Do not edit files in `examples/catalog/admin` to change the scaffold. Edit `templates/admin`, regenerate into a new empty directory and run its tests and build. Both the full application generator and standalone API/Web generators read the same app template files; only model-dependent code belongs in `generate-server.ts` and `generate-web.ts`.
