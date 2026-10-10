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
      text: Chinese documentation
      link: /guide/getting-started
    - theme: alt
      text: DSL reference
      link: /dsl/overview

features:
  - title: Data-first
    details: Model entities, fields, and relations once to drive schema, API, forms, lists, and access control.
  - title: Bun-native
    details: Generate a Bun + Elysia service and a Refine + React Router client without a Node.js runtime process.
  - title: Extensible output
    details: Generated workspaces remain ordinary TypeScript projects that teams can extend safely.
---

## Quick start

Install the Qiy executable for your platform, then run `qiy generate examples/catalog/app.qiy out/catalog-admin`.

The generated workspace contains `apps/web` for the Refine client and `apps/server` for the Bun + Elysia API. Run `bun install`, `bun run build`, and `bun run preview` inside the generated project.

## Documentation coverage

This localized entry explains the product and the primary CLI workflow. The canonical DSL reference and complete generator guide are currently maintained in Chinese; select **中文文档** in the navigation for the full reference.
