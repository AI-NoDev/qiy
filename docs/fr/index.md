---
layout: home

hero:
  name: Qiy
  text: Génération full-stack pilotée par les modèles
  tagline: Un modèle métier génère un admin Refine, une API Bun + Elysia, une couche de données Drizzle et la configuration de déploiement.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: Documentation chinoise
      link: /guide/getting-started
    - theme: alt
      text: Référence DSL
      link: /dsl/overview

features:
  - title: Les données d'abord
    details: Définissez les entités, champs et relations une fois pour piloter schéma, API, formulaires, listes et autorisations.
  - title: Natif Bun
    details: Génère Bun + Elysia et Refine sans processus Node.js persistant.
  - title: Sortie extensible
    details: Le workspace généré reste un projet TypeScript normal que les équipes peuvent étendre.
---

## Démarrage rapide

Installez l'exécutable Qiy de votre plateforme puis lancez `qiy generate examples/catalog/app.qiy out/catalog-admin`.

Le workspace contient `apps/web` pour le client Refine et `apps/server` pour l'API Bun + Elysia. Dans le projet généré, lancez `bun install`, `bun run build` et `bun run preview`.

## Couverture de la documentation

Cette entrée présente Qiy et le flux CLI principal en français. La référence DSL complète et le guide du générateur sont actuellement maintenus en chinois.
