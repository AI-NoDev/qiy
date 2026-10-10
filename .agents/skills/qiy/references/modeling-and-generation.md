# Modeling and Includes

Use `.qiy` as the public model format. Every project starts with `qiy v0;` and one `application` block. The `database` declaration is required and comes first inside the application. Add optional API, auth, storage, and workspace configuration before enums and entities; then declare relations, scopes, menus, and dashboard metrics.

## Smallest useful model

```qiy
qiy v0;

application inventory {
  database sqlite {}
  api { client rest; }

  entity products @label("Products") @icon(ShoppingOutlined) {
    field id UUID @id;
    field sku Text @unique;
    field name Text;
    field active Integer @nullable;
  }
}
```

The generated admin exposes a resource for each entity. Fields form the database columns and Refine CRUD views. Give each entity one `UUID @id` field. `@label` controls display text; `@icon` uses an Ant Design icon name such as `ShoppingOutlined`.

## Complete modular example

The [warehouse example](../examples/warehouse-admin/README.md) is a complete, runnable project with:

- a root `app.qiy` plus relative module includes;
- warehouse and product master data;
- stock movement enum with labels, colors, and icons;
- explicit foreign-key relations;
- grouped navigation and a dashboard metric;
- commands to generate, install, test, build, and preview the admin.

Use it as a working starting point, then rename fields/resources and regenerate. Do not start by copying a partial fragment without its included modules.

## Common declarations

```qiy
database postgresql { extension pgvector; }
database mysql {}
database sqlite {}

enum orderStatus {
  value draft label "Draft" color "default" icon ClockOutlined;
  value approved label "Approved" color "green" icon CheckOutlined;
}

entity orders @label("Orders") @icon(ShoppingOutlined) {
  field id UUID @id;
  field number Text @unique;
  field customerId UUID;
  field status orderStatus;
  field internalNote Text @listVisible(false) @showVisible(false);
  index orders_number_idx btree (number);
}

entity customers {
  field id UUID @id;
  field name Text;
}

relation orderCustomer orders customerId customers id one @onDelete(restrict);

menu {
  group sales @label("Sales") @icon(ShoppingOutlined) {
    resource orders;
  }
}

dashboard {
  metric orderCount orders @label("Orders") @span(8);
}
```

Supported scalar field types are `UUID`, `Text`, `Integer`, `Decimal(precision, scale)`, `Money(precision, scale)`, `DateTime`, `File`, and `Vector(dimension)`. Enum fields use the enum name as the field type. Annotate optional fields with `@nullable`; configure presentation with `@label`, `@icon`, `@listVisible`, `@showVisible`, and `@formVisible`; query behavior uses `@sortable` and `@filterable`.

For vectors, declare PostgreSQL's `pgvector` extension and annotate the field/index as required by the database model. Database capability restrictions are validated during generation. A field or relation declaration does not infer a business workflow; supported workflows must be explicitly declared and may impose entity/dialect requirements.

## Includes

Use a root project with relative fragment files:

```qiy
qiy v0;
application warehouse {
  database sqlite {}
  include "modules/catalog.qiy";
  include "modules/inventory.qiy";
}
```

An included file contains application children only. It must not repeat `qiy v0;` or wrap content in another `application`. Includes can be nested and resolve relative to the including file. Keep all fragments under the model directory. Absolute paths, `..`, missing files, symlinks escaping the project root, and include cycles are rejected.

Place top-level configuration before enums and entities. After include expansion, the whole model must follow the same declaration order as a single-file model. If parsing reports `Expected ...`, check the order and punctuation first; declarations end in semicolons except block declarations.

## Environment variables

Declare custom variables in `.qiy`; Qiy generates mode-specific server and web environment files inside the target admin packages:

```qiy
env {
  variable PAYMENT_API_URL {
    development "http://localhost:8080";
    production required;
    example "https://api.example.com";
  }
  variable PAYMENT_API_TOKEN {
    secret;
    development generate;
    production required;
    example required;
  }
}
```

`development generate` creates a random value only when the admin is first generated. `--sync` preserves current development/production values and custom entries, then appends new model variables. Prefix public frontend values with `VITE_`; these are bundled into client code and must never contain secrets. Never put literal credentials in `.qiy`. OIDC/OAuth2/SSO models also receive issuer, audience and JWKS URL variables; this config validates access tokens and is not an OAuth client-secret flow.

## Important modeling limits

- The frontend selects one DataProvider transport: `api { client rest; }` or `api { client graphql; }`.
- Use explicit `relation` declarations for foreign keys. Model many-to-many relations with an explicit join entity when supported; do not assume implicit relation generation.
- Dashboard metrics support `count`, enum `distribution`, and date `trend`; group-by fields must exist and match the metric type.
- `workflow orderInventory;` enables a specific PostgreSQL order/inventory workflow. It is not a general workflow language.
- OIDC/OAuth2/SSO configuration maps identities to a user entity; it does not automatically integrate an unrelated application's refresh cookies, JWT claims, API envelope, or authorization rules.
- Keep secrets in environment variables and secret managers, never in model files or included fragments.
