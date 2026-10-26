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
- `#` comments are preserved.

Commands need no flag: `qiy explain model.qiy`, `qiy generate model.qiy out/`, `qiy fmt model.qiy` all detect v1.

## Rejected with clear errors

- `include` (use `module`/v0 includes outside v1),
- many relations such as `lines: OrderLine[]` (declare an explicit join entity in v0),
- auth/permissions/menu/chart/dataflow and other non-entity blocks,
- custom relation names/onDelete/annotations,
- `qiy add` against a v1 entry (the add commands write v0).

Canonical docs: https://ai-nodev.github.io/qiy/guide/syntax-v1
V0 remains the production/default syntax; migrate when you only need the supported subset.
