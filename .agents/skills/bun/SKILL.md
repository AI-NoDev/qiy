---
name: bun
description: Use when building or configuring Qiy applications with Bun runtime, package management, bundling, testing, HTTP servers, or deployment targets.
metadata:
  source: https://bun.sh/docs
---

# Bun for Qiy

Use the official Bun documentation as the source of truth for runtime APIs, package management, bundling, testing, SQL, HTTP serving, and deployment behavior:

- https://bun.sh/docs

## Project constraints

- Prefer `bun install`, `bun run`, `bun test`, and `bun build` for generated projects.
- Prefer Bun-native APIs when they remove a Node-only runtime dependency.
- Treat a package as Bun-compatible only after checking its actual runtime and build behavior; do not infer compatibility from package installation alone.
- When Qiy requires strict Bun support, verify that development and build commands do not start hidden Node subprocesses.
- Generated server adapters should use the standard `fetch(Request) -> Response` boundary where a deployment target needs an external adapter.
- Keep Bun-specific code behind Qiy runtime or deployment adapters so the generated domain and business code stays portable.

## Qiy integration areas

- Bun runtime and `Bun.serve` for Elysia applications.
- Bun build output for the React Router SPA client.
- Bun test for generated API, provider, and domain tests.
- Bun SQL or the selected Drizzle driver for database access.
- Container and serverless deployment targets that can execute the generated Bun handler.

When a task depends on a specific Bun feature or version, consult the official documentation before changing the generator or runtime contract.
