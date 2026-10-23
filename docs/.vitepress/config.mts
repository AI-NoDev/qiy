import { defineConfig } from "vitepress";
import { readFileSync } from "node:fs";

const base = (process.env.VITEPRESS_BASE ?? "/").replace(/\/?$/, "/");
const qiyLanguage = JSON.parse(readFileSync(new URL("../../editors/syntax/qiy.tmLanguage.json", import.meta.url), "utf8"));
const qiyLogo = {
  light: "/qiy-logo-light.svg",
  dark: "/qiy-logo-dark.svg",
  alt: "Qiy",
};

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
  description:
    "Qiy 是一个面向数据中心业务应用的领域语言与全栈应用生成框架：一份业务模型，生成 Refine 前端、Bun + Elysia API、Drizzle 数据层与部署配置。",
  base,
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  head: [
    ["meta", { name: "theme-color", content: "#10b981" }],
    ["link", { rel: "icon", type: "image/svg+xml", media: "(prefers-color-scheme: light)", href: `${base}qiy-logo-light.svg` }],
    ["link", { rel: "icon", type: "image/svg+xml", media: "(prefers-color-scheme: dark)", href: `${base}qiy-logo-dark.svg` }],
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
            { text: "业务工作流", link: "/guide/workflow" },
            { text: "文件存储", link: "/guide/storage" },
            { text: "部署", link: "/guide/deployment" },
            { text: "真实外部服务验收", link: "/guide/real-services" },
            { text: "Android 分发", link: "/guide/android-distribution" },
          ],
        },
      ],
      "/dsl/": [
        {
          text: "语言参考",
          items: [
            { text: "总览", link: "/dsl/overview" },
            { text: "application", link: "/dsl/application" },
            { text: "entity 与 field", link: "/dsl/entity" },
            { text: "relation / index", link: "/dsl/relation-index" },
            { text: "enum / menu / dashboard", link: "/dsl/enum-menu-dashboard" },
            { text: "dataflow", link: "/dsl/dataflow" },
            { text: "action", link: "/dsl/actions" },
            { text: "realtime", link: "/dsl/realtime" },
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
