---
layout: home

hero:
  name: Qiy
  text: Geração full-stack orientada por modelos
  tagline: Um modelo de negócio gera um admin Refine, uma API Bun + Elysia, a camada de dados Drizzle e a configuração de implantação.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: Documentação em chinês
      link: /guide/getting-started
    - theme: alt
      text: Referência DSL
      link: /dsl/overview

features:
  - title: Dados primeiro
    details: Modele entidades, campos e relações uma vez para gerar schema, API, formulários, listas e permissões.
  - title: Nativo de Bun
    details: Gera Bun + Elysia e Refine sem um processo Node.js residente.
  - title: Saída extensível
    details: O workspace gerado continua sendo um projeto TypeScript comum que as equipes podem estender.
---

## Início rápido

Instale o executável Qiy para sua plataforma e execute `qiy generate examples/catalog/app.qiy out/catalog-admin`.

O workspace contém `apps/web` para o cliente Refine e `apps/server` para a API Bun + Elysia. No projeto gerado, execute `bun install`, `bun run build` e `bun run preview`.

## Cobertura da documentação

Esta página fornece uma introdução em português e o fluxo principal de CLI. A referência completa da DSL e o guia do gerador são atualmente mantidos em chinês.
