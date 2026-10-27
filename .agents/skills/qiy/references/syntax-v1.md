# v1 friendly syntax (preview)

Qiy automatically recognizes a model whose first significant line is `project <name>` or `qiy v1;`, translates it to canonical v0, then runs the normal parser/generator. The preview is intentionally small; default templates and `qiy add` remain v0.

## Supported

```qiy
qiy v1;

project shop
database sqlite

module Catalog {
  entity Product {
    name: text
    price: decimal(12, 2) nullable
  }

  entity Order {
    reference: text unique
    customer: Customer
  }
}
```

- `project <name>` replaces the v0 header/application wrapper.
- `database sqlite|postgresql|mysql` (braces optional in v1).
- `module Name { ... }` groups entities; modules are flattening sugar, not includes.
- `entity Product` → table `products`; already-lowercase names are kept as written.
- Fields: `name: type`, optional `primary`, `nullable`, `unique`; type aliases map to v0 (`uuid`→UUID, `text`→Text, `integer`→Integer, `decimal`/`money`, `date`/`time`/`datetime`, `file`/`files`, `vector(n)`).
- Missing `id` is injected as `field id UUID @id;`.
- `customer: Customer` injects `customerId UUID` plus a one relation to `customers`.
- `lines: OrderLine[]` injects a child-side `orderId UUID @nullable` plus a one relation from `order_lines` to `orders`; the child entity must be declared in the same v1 source.
- Reciprocal arrays (`tags: Tag[]` + `products: Product[]`) generate an explicit `<parent>_<target>` join entity with two one relations.
- `#` comments are preserved.
- Entry files may `include "modules/x.qiy";` v1 fragments (relative path, no `project`; fragments may contain `module`, entities or config blocks). Includes are expanded before v1 translation; `explain/generate` work normally.
- `qiy add entity/field/module/feature` also supports v1 entries; module creates a v1 fragment+include, feature edits/adds the `features` block.
- Common v0 config blocks pass through using v0 grammar and canonical order: `workspace/ui/api/features/realtime/elysia/storage/auth/env/messages/permission/workflow/enum` before entities, and `menu/dashboard/chart/dataflow/action` after relations. Entity references inside these blocks use the generated table name (`users`, `products`, ...).

Commands need no flag: `qiy explain model.qiy`, `qiy generate model.qiy out/`, `qiy fmt model.qiy` all detect v1.

## Rejected with clear errors

- one-way many declarations are treated as one-to-many; true many-to-many needs reciprocal arrays or an explicit join entity,
- auth/permissions/menu/chart/dataflow must be written as v0 passthrough blocks (supported), not v1 keyword sugar,
- custom relation names/onDelete/annotations.

Canonical docs: https://ai-nodev.github.io/qiy/guide/syntax-v1
V0 remains the production/default syntax; migrate when you only need the supported subset.
