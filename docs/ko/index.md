---
layout: home

hero:
  name: Qiy
  text: 모델 기반 풀스택 생성
  tagline: 하나의 비즈니스 모델로 Refine 관리자, Bun + Elysia API, Drizzle 데이터 계층 및 배포 구성을 생성합니다.
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: 중국어 문서
      link: /guide/getting-started
    - theme: alt
      text: DSL 참조
      link: /dsl/overview

features:
  - title: 데이터 우선
    details: entity, field, relation을 한 번 모델링하여 schema, API, 폼, 목록, 권한을 함께 구동합니다.
  - title: Bun-native
    details: Node.js 상주 프로세스 없이 Bun + Elysia 서비스와 Refine 클라이언트를 생성합니다.
  - title: 확장 가능한 결과물
    details: 생성된 결과는 일반 TypeScript 프로젝트이므로 팀에서 안전하게 확장할 수 있습니다.
---

## 빠른 시작

플랫폼용 Qiy 실행 파일을 설치한 뒤 `qiy generate examples/catalog/app.qiy out/catalog-admin`을 실행하세요.

생성된 워크스페이스에는 Refine 클라이언트용 `apps/web`와 Bun + Elysia API용 `apps/server`가 포함됩니다. 생성 폴더에서 `bun install`, `bun run build`, `bun run preview`를 실행합니다.

## 문서 범위

이 페이지는 한국어 제품 소개와 주요 CLI 사용법을 제공합니다. 전체 DSL 참조와 생성기 가이드는 현재 중국어 정본으로 유지됩니다.
