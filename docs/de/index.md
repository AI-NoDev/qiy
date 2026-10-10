---
layout: home

hero:
  name: Qiy
  text: Modellgesteuerte Full-Stack-Generierung
  tagline: Ein Geschäftsmodell erzeugt ein Refine-Admin, eine Bun + Elysia API, die Drizzle-Datenschicht und die Deployment-Konfiguration.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: Chinesische Dokumentation
      link: /guide/getting-started
    - theme: alt
      text: DSL-Referenz
      link: /dsl/overview

features:
  - title: Daten zuerst
    details: Entitäten, Felder und Relationen werden einmal modelliert und steuern Schema, API, Formulare, Listen und Berechtigungen.
  - title: Bun-native
    details: Erzeugt Bun + Elysia sowie Refine ohne einen dauerhaften Node.js-Prozess.
  - title: Erweiterbare Ausgabe
    details: Der erzeugte Workspace bleibt ein normales TypeScript-Projekt und kann sicher erweitert werden.
---

## Schnellstart

Installieren Sie die Qiy-Datei für Ihre Plattform und führen Sie `qiy generate examples/catalog/app.qiy out/catalog-admin` aus.

Der Workspace enthält `apps/web` für den Refine-Client und `apps/server` für die Bun + Elysia API. Führen Sie dort `bun install`, `bun run build` und `bun run preview` aus.

## Dokumentationsumfang

Diese Seite liefert eine deutsche Einführung und den zentralen CLI-Ablauf. Die vollständige DSL-Referenz und der Generator-Leitfaden werden derzeit auf Chinesisch gepflegt.
