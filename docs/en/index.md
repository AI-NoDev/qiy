---
layout: home

hero:
  name: Qiy
  text: Model-driven full-stack application generation
  tagline: Define one business model and generate a Refine admin, Bun + Elysia API, Drizzle data layer, and deployment configuration.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: Get started
      link: /en/guide/getting-started
    - theme: alt
      text: What is Qiy
      link: /en/guide/what-is-qiy
    - theme: alt
      text: DSL reference
      link: /en/guide/dsl-reference

features:
  - title: Data-first
    details: Model entities, fields, and relations once to drive schema, API, forms, lists, and access control.
  - title: Bun-native
    details: Generate a Bun + Elysia service and a Refine + React Router client without a Node.js runtime process.
  - title: Fail closed
    details: Roles, permissions, data scopes and record policies are checked at generation time and enforced on every read and write.
  - title: Extensible output
    details: Generated workspaces remain ordinary TypeScript projects that teams can extend safely.
---

## Quick start

```bash
qiy create project shop
cd shop
qiy dev
```

`qiy dev` generates the workspace, applies the SQLite schema and starts the API on `:3000` and the admin on `:5173`. Continue with [Getting started](/en/guide/getting-started), then [Data modeling](/en/guide/data-modeling).

## Documentation coverage

The English guide covers the whole workflow: modeling, authentication and permissions, business commands, deployment and upgrades, plus a one-page [DSL reference](/en/guide/dsl-reference). The exhaustive per-construct reference, with every setting and error message, is maintained in Chinese; select **中文文档** in the navigation.
