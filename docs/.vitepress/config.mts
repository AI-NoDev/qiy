import { defineConfig } from "vitepress";
import { readFileSync } from "node:fs";
import { descriptionFor } from "./seo";

const base = (process.env.VITEPRESS_BASE ?? "/").replace(/\/?$/, "/");
const siteUrl = (process.env.QIY_DOCS_SITE_URL ?? "https://ai-nodev.github.io/qiy").replace(/\/$/, "");
const siteDescription =
  "Qiy 是一个面向数据中心业务应用的领域语言与全栈应用生成框架：一份业务模型，生成 Refine 前端、Bun + Elysia API、Drizzle 数据层与部署配置。";
const qiyLanguage = JSON.parse(readFileSync(new URL("../../editors/syntax/qiy.tmLanguage.json", import.meta.url), "utf8"));
const qiyLogo = {
  light: "/qiy-logo-light.svg",
  dark: "/qiy-logo-dark.svg",
  alt: "Qiy",
};

/** Canonical production URL for a VitePress page (used by sitemap/SEO tags). */
function canonicalUrl(relativePath: string): string {
  const path = relativePath.replace(/\\/g, "/").replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
  return `${siteUrl}/${path}`.replace(/\/+$/, "/");
}

function localizedTheme(localeRoot: string, guideLabel: string, chineseDocsLabel: string, footerMessage: string) {
  return {
    logo: qiyLogo,
    siteTitle: "Qiy",
    nav: [
      { text: guideLabel, link: localeRoot },
      { text: chineseDocsLabel, link: "/guide/what-is-qiy" },
    ],
    i18nRouting: false,
    socialLinks: [{ icon: "github", link: "https://github.com/AI-NoDev/qiy" }],
    footer: {
      message: footerMessage,
      copyright: "Copyright © 2026 Qiy Contributors",
    },
    search: { provider: "local" },
  };
}

export default defineConfig({
  lang: "zh-CN",
  title: "Qiy",
  description: siteDescription,
  base,
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  // `public/` holds downloadable assets, including the Agent Skill markdown
  // files; they must be copied verbatim and never treated as documentation pages.
  srcExclude: ["public/**"],
  sitemap: { hostname: `${siteUrl}/` },
  transformHead: ({ pageData, siteConfig }) => {
    const title = pageData.title ? `${pageData.title} | Qiy` : "Qiy";
    const description = pageData.description || descriptionFor(pageData.relativePath, siteConfig.description || siteDescription);
    const url = canonicalUrl(pageData.relativePath);
    const isHome = /(^|\/)index\.md$/.test(pageData.relativePath);
    const language = pageData.relativePath.split("/")[0];
    const articleLanguage = ["de", "en", "es", "fr", "ja", "ko", "pt", "ru"].includes(language) ? language : "zh-CN";
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": isHome ? "WebSite" : "TechArticle",
      headline: pageData.title || "Qiy",
      name: pageData.title || "Qiy",
      description,
      url,
      inLanguage: articleLanguage,
      isPartOf: { "@type": "WebSite", name: "Qiy", url: `${siteUrl}/` },
      publisher: { "@type": "Organization", name: "Qiy Contributors", url: "https://github.com/AI-NoDev/qiy" },
    };
    return [
      ["meta", { name: "description", content: description }],
      ["meta", { name: "robots", content: "index,follow" }],
      ["meta", { property: "og:type", content: isHome ? "website" : "article" }],
      ["meta", { property: "og:site_name", content: "Qiy" }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:image", content: `${siteUrl}/qiy-logo-light.svg` }],
      ["meta", { property: "og:image:alt", content: "Qiy logo" }],
      ["meta", { name: "twitter:card", content: "summary" }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
      ["link", { rel: "canonical", href: url }],
      ["script", { type: "application/ld+json" }, JSON.stringify(jsonLd)],
    ];
  },
  head: [
    ["meta", { name: "theme-color", content: "#10b981" }],
    ["link", { rel: "icon", type: "image/svg+xml", media: "(prefers-color-scheme: light)", href: `${base}qiy-logo-light.svg` }],
    ["link", { rel: "icon", type: "image/svg+xml", media: "(prefers-color-scheme: dark)", href: `${base}qiy-logo-dark.svg` }],
    // Machine-readable documentation index and full text for LLM/agent retrieval.
    ["link", { rel: "alternate", type: "text/plain", title: "llms.txt", href: `${base}llms.txt` }],
    ["link", { rel: "alternate", type: "text/plain", title: "llms-full.txt", href: `${base}llms-full.txt` }],
    ["link", { rel: "sitemap", type: "application/xml", href: `${base}sitemap.xml` }],
  ],
  locales: {
    root: { label: "简体中文", lang: "zh-CN" },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      title: "Qiy",
      description: "A model-driven full-stack application generator.",
      themeConfig: localizedTheme("/en/", "Guides", "中文文档", "Built with VitePress."),
    },
    ja: {
      label: "日本語",
      lang: "ja-JP",
      link: "/ja/",
      title: "Qiy",
      description: "モデル駆動のフルスタックアプリケーションジェネレーター。",
      themeConfig: localizedTheme("/ja/", "ガイド", "中文文档", "VitePress で構築。"),
    },
    ko: {
      label: "한국어",
      lang: "ko-KR",
      link: "/ko/",
      title: "Qiy",
      description: "모델 기반 풀스택 애플리케이션 생성기.",
      themeConfig: localizedTheme("/ko/", "가이드", "中文文档", "VitePress로 구축되었습니다."),
    },
    de: {
      label: "Deutsch",
      lang: "de-DE",
      link: "/de/",
      title: "Qiy",
      description: "Modellgesteuerter Generator für Full-Stack-Anwendungen.",
      themeConfig: localizedTheme("/de/", "Leitfäden", "Chinesische Dokumentation", "Erstellt mit VitePress."),
    },
    fr: {
      label: "Français",
      lang: "fr-FR",
      link: "/fr/",
      title: "Qiy",
      description: "Générateur d'applications full-stack piloté par les modèles.",
      themeConfig: localizedTheme("/fr/", "Guides", "Documentation chinoise", "Créé avec VitePress."),
    },
    es: {
      label: "Español",
      lang: "es-ES",
      link: "/es/",
      title: "Qiy",
      description: "Generador de aplicaciones full-stack basado en modelos.",
      themeConfig: localizedTheme("/es/", "Guías", "Documentación en chino", "Creado con VitePress."),
    },
    pt: {
      label: "Português",
      lang: "pt-BR",
      link: "/pt/",
      title: "Qiy",
      description: "Gerador de aplicações full-stack orientado por modelos.",
      themeConfig: localizedTheme("/pt/", "Guias", "Documentação em chinês", "Criado com VitePress."),
    },
    ru: {
      label: "Русский",
      lang: "ru-RU",
      link: "/ru/",
      title: "Qiy",
      description: "Генератор полнофункциональных приложений на основе моделей.",
      themeConfig: localizedTheme("/ru/", "Руководства", "Документация на китайском", "Создано с VitePress."),
    },
  },
  markdown: {
    lineNumbers: false,
    languages: [qiyLanguage],
  },
  themeConfig: {
    logo: qiyLogo,
    siteTitle: "Qiy",
    nav: [
      { text: "指南", link: "/guide/what-is-qiy", activeMatch: "/guide/" },
      { text: "DSL", link: "/dsl/overview", activeMatch: "/dsl/" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始",
          items: [
            { text: "Qiy 是什么", link: "/guide/what-is-qiy" },
            { text: "设计理念", link: "/guide/design-philosophy" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "CLI 与发布", link: "/guide/cli" },
            { text: "集成现有 Bun 项目", link: "/guide/existing-bun-project" },
            { text: "模块化模型", link: "/guide/modules" },
            { text: "最佳实践：仓储系统", link: "/guide/best-practice-warehouse" },
            { text: "编辑器支持", link: "/guide/editor-support" },
            { text: "Agent Skill", link: "/guide/agent-skill" },
            { text: "生成的项目结构", link: "/guide/project-structure" },
          ],
        },
        {
          text: "模型与生成",
          items: [
            { text: "定义数据模型", link: "/guide/data-modeling" },
            { text: "API 与数据源", link: "/guide/api" },
            { text: "认证与权限", link: "/guide/auth" },
            { text: "Refine Providers", link: "/guide/refine-providers" },
            { text: "UI 与主题", link: "/guide/ui-theming" },
            { text: "菜单与 Dashboard", link: "/guide/menu-dashboard" },
            { text: "API 文档与访问密钥", link: "/guide/api-docs-and-keys" },
            { text: "业务工作流", link: "/guide/workflow" },
            { text: "文件存储", link: "/guide/storage" },
            { text: "DSL 用法手册（按目标分组）", link: "/guide/dsl-cookbook" },
            { text: "部署", link: "/guide/deployment" },
            { text: "真实外部服务验收", link: "/guide/real-services" },
          ],
        },
      ],
      "/dsl/": [
        {
          text: "语言参考",
          items: [
            { text: "总览", link: "/dsl/overview" },
            { text: "模块化模型（include）", link: "/dsl/modules" },
            { text: "application", link: "/dsl/application" },
            { text: "entity 与 field", link: "/dsl/entity" },
            { text: "relation / index", link: "/dsl/relation-index" },
            { text: "自动生成值与业务编码", link: "/dsl/generated-values" },
            { text: "enum / menu / dashboard", link: "/dsl/enum-menu-dashboard" },
            { text: "chart（多视图图表）", link: "/dsl/charts" },
            { text: "多语言（messages / i18n）", link: "/dsl/i18n" },
            { text: "认证与登录（auth）", link: "/dsl/auth" },
            { text: "权限（permission）", link: "/dsl/permissions" },
            { text: "dataflow", link: "/dsl/dataflow" },
            { text: "action", link: "/dsl/actions" },
            { text: "realtime", link: "/dsl/realtime" },
            { text: "storage（文件存储）", link: "/dsl/storage" },
            { text: "features（系统管理功能开关）", link: "/dsl/features" },
            { text: "注解总览（@annotations）", link: "/dsl/annotations" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/AI-NoDev/qiy" },
    ],
    footer: {
      message: "Released under the MIT License. Built with VitePress.",
      copyright: "Copyright © 2026 Qiy Contributors",
    },
    search: {
      provider: "local",
    },
    i18nRouting: false,
  },
});
