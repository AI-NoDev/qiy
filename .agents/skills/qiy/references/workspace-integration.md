# Existing Bun Project and Aliases

Run `qiy init` at the host project root. The root must contain a `package.json` with a Bun package manager declaration:

```json
{
  "packageManager": "bun@1.3.13"
}
```

Declare aliases in the `.qiy` model when the host repository already has common names:

```qiy [models/admin.qiy]
workspace {
  name admin;
  aliases {
    server ops-api;
    web ops-console;
    deploy ops-admin;
  }
  packages {
    server "@example/ops-api";
    web "@example/ops-console";
  }
}
```

Directory aliases use lowercase letters, numbers, and hyphens. Package aliases use valid npm package names. The resulting files include:

```text
apps/ops-api/
apps/ops-console/
deploy/ops-admin/
ops-admin.Dockerfile
docker-compose.ops-admin.yml
.qiy-admin.generated.json
```

The host `package.json` keeps its existing workspaces and receives `apps/*` if needed. Qiy adds scripts such as `qiy:admin:typecheck`, `qiy:admin:test`, and `qiy:admin:preview`. Existing scripts with a different command cause the command to fail instead of being replaced. `-n` remains an optional one-off command-line override; otherwise `workspace.name`, then the application name, is used.

The manifest is the sync ownership boundary. Qiy may rewrite manifest files and remove files that the new model no longer generates. It will not delete or overwrite unlisted host files, even with `--sync`.

Keep custom code in unowned paths such as:

```text
apps/ops-api/src/integrations/host-auth.ts
apps/ops-api/src/modules/connectors/
apps/ops-console/app/plugins/host-data-provider.ts
apps/ops-console/app/hooks/use-connector-status.ts
```
