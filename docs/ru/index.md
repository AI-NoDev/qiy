---
layout: home

hero:
  name: Qiy
  text: Полнофункциональная генерация на основе моделей
  tagline: Одна бизнес-модель создаёт админ-панель Refine, API Bun + Elysia, слой данных Drizzle и конфигурацию развёртывания.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: Документация на китайском
      link: /guide/getting-started
    - theme: alt
      text: Справочник DSL
      link: /dsl/overview

features:
  - title: Данные прежде всего
    details: Опишите сущности, поля и связи один раз, чтобы управлять схемой, API, формами, списками и правами доступа.
  - title: Нативно для Bun
    details: Создаёт Bun + Elysia и Refine без постоянно работающего процесса Node.js.
  - title: Расширяемый результат
    details: Сгенерированный workspace остаётся обычным TypeScript-проектом, который команда может безопасно расширять.
---

## Быстрый старт

Установите исполняемый файл Qiy для своей платформы и выполните `qiy generate examples/catalog/app.qiy out/catalog-admin`.

Workspace содержит `apps/web` для клиента Refine и `apps/server` для API Bun + Elysia. В сгенерированном проекте выполните `bun install`, `bun run build` и `bun run preview`.

## Охват документации

Эта страница даёт русскоязычное введение и основной сценарий CLI. Полный справочник DSL и руководство генератора пока поддерживаются на китайском языке.
