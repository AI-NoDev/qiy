---
layout: home

hero:
  name: Qiy
  text: Generación full-stack basada en modelos
  tagline: Un modelo de negocio genera un administrador Refine, una API Bun + Elysia, una capa de datos Drizzle y configuración de despliegue.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: Documentación en chino
      link: /guide/getting-started
    - theme: alt
      text: Referencia DSL
      link: /dsl/overview

features:
  - title: Datos primero
    details: Modele entidades, campos y relaciones una vez para impulsar esquema, API, formularios, listas y permisos.
  - title: Nativo de Bun
    details: Genera Bun + Elysia y Refine sin un proceso residente de Node.js.
  - title: Salida extensible
    details: El workspace generado sigue siendo un proyecto TypeScript normal que los equipos pueden ampliar.
---

## Inicio rápido

Instale el ejecutable Qiy para su plataforma y ejecute `qiy generate examples/catalog/app.qiy out/catalog-admin`.

El workspace contiene `apps/web` para el cliente Refine y `apps/server` para la API Bun + Elysia. En el proyecto generado ejecute `bun install`, `bun run build` y `bun run preview`.

## Cobertura documental

Esta página ofrece una introducción en español y el flujo de trabajo CLI principal. La referencia DSL completa y la guía del generador se mantienen actualmente en chino.
