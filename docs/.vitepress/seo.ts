/**
 * Per-page descriptions for search engines, OpenGraph, Twitter cards and
 * JSON-LD. VitePress otherwise inherits one site-wide description for every
 * page; `tests/docs-seo.test.ts` fails when a documentation page is missing an
 * entry here, so add a concise, page-specific sentence when adding a page.
 */
export const pageDescriptions: Record<string, string> = {
  "index.md": "Qiy 是以一份业务模型生成 Refine 前端、Bun + Elysia API、Drizzle 数据层与部署配置的全栈应用生成器。",
  "dsl/overview.md": "Qiy DSL 总览：词法规则、application 块顺序、校验流水线、i18n 键与生成结果。",
  "dsl/application.md": "application 块参考：database、mode、workspace、ui、api、features、realtime、elysia、storage、auth、env、messages 与权限/命令配置。",
  "dsl/entity.md": "entity 与 field 语法：字段类型、@id/@unique/@nullable、注解、显示模板、默认值、过滤与树形资源。",
  "dsl/relation-index.md": "relation 与 index 语法：外键关系、自关联、复合索引、唯一索引及其生成结果。",
  "dsl/generated-values.md": "@code 与 @generated 字段：业务编码模板、序列分配、UUID/时间生成与服务端注入规则。",
  "dsl/annotations.md": "Qiy 注解完整清单：@label、@icon、@display、@comment、@group、@order、@listVisible 等行为与校验。",
  "dsl/errors.md": "Qiy 错误码目录（QIY1001–QIY1016）：常见解析、校验、权限、chart、scope、skill 与 --sync 错误的含义和修复建议。",
  "dsl/modules.md": "Qiy 模块化：include 相对路径、片段拆分、共享常量与多文件项目的解析顺序。",
  "dsl/permissions.md": "权限系统：permission field/group/from/verification、allow 命令策略、restrict 行级与字段策略、scope 与 pages。",
  "dsl/auth.md": "认证参考：local、OTP、单 OIDC、多 Provider、hybrid 模式，用户映射、会话、onboarding 与密钥绑定。",
  "dsl/dataflow.md": "dataflow 事务命令参考：input/context/step、require/update/create/delete/emit/call/audit、幂等、批量与结果。",
  "dsl/actions.md": "action 参考：命令按钮、列表/详情放置、手动页面、批处理、条件与数据流目标。",
  "dsl/realtime.md": "realtime 参考：订阅模式、事件、角色、资源声明、transport 与 outbox 运维接口。",
  "dsl/storage.md": "storage 参考：本地/S3 provider、File/Files 字段、上传与分片/断点续传、权限、环境变量与清理。",
  "dsl/features.md": "features 参考：功能总览、API 文档、访问密钥三个开发者页面的开关、菜单/路由与 OpenAPI 过滤。",
  "dsl/charts.md": "chart DSL 参考：const/pie/bar/line/table 视图、数据迷你语言、labels、chart panels 响应式栅格与限制。",
  "dsl/i18n.md": "Qiy 多语言：messages 默认语言、locale 词典、模型派生键、界面 chrome 键与回退链。",
  "dsl/enum-menu-dashboard.md": "enum、menu 与 dashboard 参考：枚举值注解、分组折叠菜单、旧版指标卡片与页面布局。",
  "en/guide/getting-started.md": "Get started with Qiy: install the CLI, create a modular .qiy project, generate, migrate and run the admin.",
  "guide/plugins.md": "Qiy 生成器插件：在 qiy.project.json 声明本地模块，向生成工作区追加文件，路径与覆盖保护、diff/同步语义。",
  "guide/mcp.md": "Qiy MCP server：通过 stdio 暴露 qiy_explain、qiy_schema 与错误码目录，供 Agent 只读校验和解释 .qiy 模型。",
  "en/guide/cli.md": "Qiy CLI reference: project commands, diff/incremental generation, model inspection, agent skills and release flow.",
  "guide/what-is-qiy.md": "Qiy 是什么：模型驱动生成器的工作方式、生成物架构、适用场景以及与手写全栈的分工。",
  "guide/tasks.md": "按任务查找 Qiy 文档：创建项目、建模、权限、界面、集成、部署与 AI Agent 的入口索引。",
  "guide/design-philosophy.md": "Qiy 设计理念：项目优先、命令优先、模块默认、受限自然语法、安全默认与 AI Agent 一等用户。",
  "guide/syntax-v1.md": "Qiy v1 友好语法预览：project/module、name: type 字段、自动主键、内联一对一关系、支持范围与限制。",
  "guide/getting-started.md": "快速开始：安装 Qiy CLI、创建第一个 .qiy 模型、生成、安装依赖、迁移、运行与预览。",
  "guide/project-structure.md": "生成项目结构：server / web workspace、owned 与 unowned 文件、扩展点与生成清单。",
  "guide/cli.md": "Qiy CLI 参考：create、init、generate --sync、doctor、skill install 及各命令参数与环境要求。",
  "guide/data-modeling.md": "数据建模指南：实体、类型、关系、索引、业务编码、显示模板与常见建模决策。",
  "guide/modules.md": "模块化项目指南：用 include 拆分模型、共享 fragments 与多模块协作方式。",
  "guide/menu-dashboard.md": "菜单与概览页指南：分组侧边栏、菜单权限、旧版 dashboard 与 chart 面板混排。",
  "guide/auth.md": "认证接入指南：本地密码、OIDC/OAuth、OTP、hybrid、多 Provider、用户绑定与回调排障。",
  "guide/api.md": "API 使用指南：REST/GraphQL、分页排序过滤、CSV 导入导出、保存视图、订阅与错误契约。",
  "guide/api-docs-and-keys.md": "API 文档与访问密钥：开发者页面、permission 过滤的 OpenAPI、API Key 创建/撤销与调用方式。",
  "guide/workflow.md": "业务工作流：dataflow 命令与 orderInventory 工作流的组合、幂等与审计。",
  "guide/refine-providers.md": "Refine Provider 指南：生成的 DataProvider/AuthProvider/AccessControl/Live/Audit/Notification 接线与扩展。",
  "guide/ui-theming.md": "UI 与主题：Ant Design 适配器、主题色、明暗模式、sider 折叠持久化与界面定制边界。",
  "guide/storage.md": "存储配置指南：本地与 S3、上传大小/类型策略、附件权限、分片上传与孤儿清理。",
  "guide/deployment.md": "部署指南：生产环境变量、Docker/Kubernetes、反向代理、数据库迁移、备份与健康检查。",
  "guide/real-services.md": "真实服务验收：数据库、OIDC、S3、实时 transport 的端到端检查清单与常见失败模式。",
  "guide/existing-bun-project.md": "接入现有 Bun 项目：init 前置条件、aliases、路径冲突、--sync 所有权与增量生成边界。",
  "guide/best-practice-warehouse.md": "仓储后台最佳实践：从 .qiy 模型到库存、仓库、单据与报表的完整示例。",
  "guide/dsl-cookbook.md": "Qiy DSL 用法手册：按目标分组的数据建模、权限、自动化、图表、多语言与系统管理配方。",
  "guide/agent-skill.md": "Qiy Agent Skill：标准 SKILL.md、模块化 references、静态下载与 qiy skill install 项目/全局安装方式。",
  "guide/editor-support.md": "编辑器支持：VS Code 与 JetBrains 插件的语法高亮、诊断与安装方式。",
  "en/index.md": "Qiy documentation: generate a Refine admin, Bun + Elysia API, Drizzle data layer and deployment config from one model.",
  "ja/index.md": "Qiy ドキュメント: 1 つのモデルから Refine 管理画面、Bun + Elysia API、Drizzle データ層、デプロイ設定を生成します。",
  "ko/index.md": "Qiy 문서: 하나의 모델로 Refine 관리자, Bun + Elysia API, Drizzle 데이터 계층, 배포 구성을 생성합니다.",
  "de/index.md": "Qiy-Dokumentation: Aus einem Modell entstehen Refine-Admin, Bun + Elysia API, Drizzle-Datenschicht und Deployment-Konfiguration.",
  "fr/index.md": "Documentation Qiy : générez une administration Refine, une API Bun + Elysia, une couche Drizzle et le déploiement depuis un modèle.",
  "es/index.md": "Documentación de Qiy: genera un admin Refine, API Bun + Elysia, capa Drizzle y despliegue a partir de un modelo.",
  "pt/index.md": "Documentação do Qiy: gere um admin Refine, API Bun + Elysia, camada Drizzle e implantação a partir de um modelo.",
  "ru/index.md": "Документация Qiy: из одной модели создаются админка Refine, API Bun + Elysia, слой Drizzle и конфигурация деплоя.",
};

export function descriptionFor(relativePath: string, fallback: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  return pageDescriptions[normalized] ?? fallback;
}
