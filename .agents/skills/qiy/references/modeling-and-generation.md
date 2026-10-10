# Model and Include Syntax

## Public input

Use `.qiy` as the public input format. A minimal model looks like this:

```qiy [models/catalog.qiy]
qiy v0;
application catalog {
  database sqlite {}
  api { client rest; }
  entity products {
    field id UUID @id;
    field title Text;
    field createdAt DateTime;
  }
}
```

Organize a larger model with relative fragments:

```qiy [models/catalog.qiy]
qiy v0;
include "shared/database.qiy";
include "catalog/entities.qiy";
```

Includes must remain inside the model root. Qiy rejects absolute paths, `..` traversal, missing files, and recursive include chains. Keep the version and declaration order valid across the combined model.

## What Qiy generates

- `apps/server/`: Bun + Elysia API, contracts, repositories, services, authentication, storage, migrations, and tests.
- `apps/web/`: Refine resources, React Router routes, Ant Design layout, forms, list controls, i18n, auth/access control, and tests.
- `deploy/`: Nginx, Kubernetes, and Vercel examples.
- Root Dockerfile, Compose file, workspace scripts, and package metadata.

The web app chooses one frontend transport, REST or GraphQL. The server may expose both when configured, but generated pages should use the selected Refine DataProvider.

## Model decisions

- Declare a workflow explicitly; Qiy does not infer a business transaction from entity names.
- Use relations for explicit foreign keys. Do not assume implicit many-to-many support unless the model and generated contract provide it.
- Keep password hashes, access tokens, and provider secrets out of models and config files.
- Use S3-compatible storage for durable multi-replica deployments and configure credentials through environment variables.
- Treat generated pages as an admin foundation. Add domain commands, queues, audit rules, connector authorization, and synchronization logic in your own extension files.
