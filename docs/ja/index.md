---
layout: home

hero:
  name: Qiy
  text: モデル駆動のフルスタック生成
  tagline: 1 つの業務モデルから Refine 管理画面、Bun + Elysia API、Drizzle データ層、デプロイ設定を生成します。
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: 中国語ドキュメント
      link: /guide/getting-started
    - theme: alt
      text: DSL リファレンス
      link: /dsl/overview

features:
  - title: データ中心
    details: entity、field、relation を 1 回定義し、schema、API、フォーム、一覧、権限に反映します。
  - title: Bun-native
    details: Node.js の常駐プロセスに依存せず、Bun + Elysia と Refine を生成します。
  - title: 拡張可能な出力
    details: 生成結果は通常の TypeScript プロジェクトなので安全に拡張できます。
---

## クイックスタート

利用するプラットフォーム向けの Qiy 実行ファイルを導入し、`qiy generate examples/catalog/app.qiy out/catalog-admin` を実行します。

生成されたワークスペースには Refine クライアントの `apps/web` と Bun + Elysia API の `apps/server` が含まれます。生成先で `bun install`、`bun run build`、`bun run preview` を実行してください。

## ドキュメント範囲

この入口ページでは製品概要と主要 CLI ワークフローを日本語で案内します。完全な DSL リファレンスと生成ガイドは現在中国語を正本として管理しています。
