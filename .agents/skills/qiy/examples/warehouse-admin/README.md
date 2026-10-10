# Warehouse Admin Example

This is a complete modular Qiy project. Copy the entire `warehouse-admin` folder into your own project (for example, as `models/warehouse`), then run Qiy from your project root. Do not separate `app.qiy` from the `modules/` directory: the root model includes those files by relative path.

The model generates warehouses, products, and stock movements; explicit warehouse/product relations; movement type labels/colors/icons; grouped navigation; and a movement count dashboard.

## Generate and run

From the project root after copying this folder to models/warehouse:

~~~sh
qiy create -f models/warehouse/app.qiy -n warehouse-admin -o out/warehouse-admin
cd out/warehouse-admin
bun install
bun run typecheck
bun run test
bun run build
bun run preview
~~~

Open http://127.0.0.1:3000/movements (or the URL printed by preview). The preview uses in-memory data and is for local evaluation only.

The generated workspace includes `apps/server` (Bun + Elysia API, Drizzle schema and tests), `apps/web` (Refine + Ant Design + React Router), and deployment examples. Try the warehouse, product, and movement resources; inspect the Operations/Master data menu groups and the movement count dashboard. The generated app is editable source, but preview data is not durable and is not a production deployment.

## Integrate into an existing Bun project

The same model contains optional workspace aliases. From a host Bun project's root, whose package.json declares packageManager bun@<version>, run:

~~~sh
qiy init -f models/warehouse/app.qiy
bun install
bun run qiy:warehouse-admin:typecheck
bun run qiy:warehouse-admin:test
~~~

This adds apps/ops-api and apps/ops-console, deploy/ops-admin, ops-admin.Dockerfile, and docker-compose.ops-admin.yml. It does not add Turborepo. Change names in the workspace block before generation if those paths conflict with the host project.

For later model changes, run `qiy init -f models/warehouse/app.qiy --sync` and review the diff. Keep custom integrations in files not owned by Qiy, for example `apps/ops-api/src/integrations/` and `apps/ops-console/app/plugins/`. Never assume sync preserves edits made directly inside generated files.

## Troubleshooting

- Missing include: copy the complete example folder and keep module paths relative to the file containing each `include`.
- Name/path collision during `init`: change `workspace.aliases` in `app.qiy`, then retry; do not remove host files to force generation.
- Preview port is occupied: stop the other process or set a free `PORT` for the preview process.
- A generated build passes but a real service fails: configure and test the database, identity provider, storage, and external API separately; compilation is not a production integration test.

## Files

~~~text
warehouse-admin/
|-- app.qiy
|-- README.md
+-- modules/
    |-- application-config.qiy
    |-- catalog.qiy
    |-- inventory.qiy
    |-- navigation.qiy
    +-- shared/
        +-- enums.qiy
~~~

app.qiy is the only entrypoint. Included files are application fragments: they do not repeat the qiy version or application wrapper.
