import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Project manifest written by `qiy create project`. */
export interface QiyProjectManifest {
  formatVersion: 1;
  name: string;
  template: "minimal" | "standard";
  /** Entry `.qiy` model, relative to the project root. */
  model: string;
  /** Generated workspace, relative to the project root. */
  output: string;
  /** Optional local generator plugin modules, relative to the project root. */
  plugins?: string[];
}

export interface QiyProjectLocation {
  root: string;
  manifest: QiyProjectManifest;
  modelPath: string;
  outputPath: string;
}

export const QIY_PROJECT_FILE = "qiy.project.json";

export function findQiyProjectRoot(startDirectory = process.cwd()): string | undefined {
  let directory = resolve(startDirectory);
  for (;;) {
    if (existsSync(join(directory, QIY_PROJECT_FILE))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function readQiyProject(root: string): QiyProjectLocation {
  const manifestPath = join(root, QIY_PROJECT_FILE);
  if (!existsSync(manifestPath)) throw new Error(`Missing ${QIY_PROJECT_FILE} in ${root}. Run this command inside a project created by qiy create project.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as QiyProjectManifest;
  if (manifest.formatVersion !== 1 || typeof manifest.name !== "string" || typeof manifest.model !== "string" || typeof manifest.output !== "string") {
    throw new Error(`Invalid ${QIY_PROJECT_FILE}: expected formatVersion 1, name, model and output.`);
  }
  if (manifest.plugins !== undefined && (!Array.isArray(manifest.plugins) || manifest.plugins.some((plugin) => typeof plugin !== "string"))) {
    throw new Error(`Invalid ${QIY_PROJECT_FILE}: plugins must be an array of relative module paths.`);
  }
  const modelPath = resolve(root, manifest.model);
  const outputPath = resolve(root, manifest.output);
  if (!existsSync(modelPath)) throw new Error(`Project model not found: ${modelPath}`);
  return { root, manifest, modelPath, outputPath };
}

/** Resolves the project containing the current directory, or throws a helpful error. */
export function requireQiyProject(startDirectory = process.cwd()): QiyProjectLocation {
  const root = findQiyProjectRoot(startDirectory);
  if (!root) throw new Error(`No ${QIY_PROJECT_FILE} found in ${startDirectory} or its parents. Run \`qiy create project <name>\` first, or use qiy create/generate with explicit paths.`);
  return readQiyProject(root);
}

export function isValidProjectName(name: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name);
}

const sharedReadme = (name: string) => `# ${name}

A Qiy project: the modular model lives in \`model/\`, and \`admin/\` is generated
by Qiy from that model.

\`\`\`bash
qiy check       # validate the model without writing files
qiy generate    # (re)generate admin/
qiy dev         # generate + install (first run) + start API and admin
qiy test        # generated test suites
qiy build       # production build
\`\`\`

Edit \`model/app.qiy\` and the files under \`model/modules/\`, then run
\`qiy generate\` (or keep \`qiy dev\` running) and review the generated diff.

The model entry is \`model/app.qiy\`; every included fragment must keep the Qiy
declaration order documented at https://ai-nodev.github.io/qiy/dsl/modules.
`;

const gitignore = `admin/node_modules/
admin/apps/*/node_modules/
admin/.env.development
admin/.env.production
admin/apps/*/.env.development
admin/apps/*/.env.production
.agents/skills/qiy/node_modules/
`;

function appModel(name: string, template: QiyProjectManifest["template"]): string {
  const includes = template === "minimal"
    ? [`  include "modules/10-catalog.qiy";`]
    : [
        `  include "modules/10-catalog.qiy";`,
        `  include "modules/20-relations.qiy";`,
        `  include "modules/30-ui.qiy";`,
      ];
  return `qiy v0;

# ${name} — Qiy project model.
#
# Keep the entry file small: project-level configuration and includes only.
# Run \`qiy check\` after edits, then \`qiy generate\` (or \`qiy dev\`).
application ${name} @comment("${name} Qiy application") {
  database sqlite {}
  api { client rest; }

${includes.join("\n")}
}
`;
}

const minimalCatalog = `# A minimal catalog sample. Add fields and entities here.
entity products {
  field id UUID @id;
  field name Text @unique;
  field price Money(12, 2) @nullable;
}
`;

const standardCatalog = `# Catalog entities. Keep one business domain per module.
entity products {
  field id UUID @id;
  field sku Text @unique @code("SKU-{seq:4}");
  field name Text;
  field price Money(12, 2) @nullable;
}

entity orders {
  field id UUID @id;
  field productId UUID;
  field quantity Integer;
  field placedAt DateTime;
}
`;

const relations = `# Relations are declared after all entities (Qiy declaration order).
relation orderProduct orders productId products id one;
`;

const ui = `# Navigation and dashboard. Menu groups become collapsible sidebar groups.
menu {
  group catalog @label("Catalog") @icon(AppstoreOutlined) {
    resource products;
    resource orders;
  }
}

# A multi-view chart. Same name + different kind = view switcher on one card.
chart const ProductCount {
  icon = "AppstoreOutlined";
  title = "Products";
  data = count products;
}
`;

const permissionsSample = `# Permission sample (not included yet).
#
# Uncomment this file's contents and add the include after app configuration:
#   include "modules/40-permissions.qiy";
#
# permission field ApiGetProductPermission "products:read";
# permission group admin { ApiGetProductPermission }
# permission group operator { ApiGetProductPermission }
`;

const dataflowSample = `# Dataflow sample (not included yet).
#
# A dataflow is one transactional business command. Uncomment and add:
#   include "modules/50-dataflows.qiy";
#
# dataflow archiveOrder {
#   allow roles admin;
#   idempotency required;
#   audit "order.archived";
#
#   input { field orderId UUID @required; }
#
#   context { order = entity orders by id input.orderId @required; }
#
#   step archive @order(10) {
#     update order { placedAt = "2026-01-01T00:00:00Z"; }
#   }
#
#   result { return order; }
# }
`;

const messagesSample = `# Optional i18n dictionary (not included yet).
#
# messages {
#   default "zh-CN";
#   locale "zh-CN" {
#     "qiy.resources.products.label" "产品";
#   }
#   locale "en-US" {
#     "qiy.resources.products.label" "Products";
#   }
# }
`;

export interface CreatedQiyProject {
  root: string;
  files: string[];
}

/** Creates a modular Qiy project directory (model + manifest + README). */
export function createQiyProject(name: string, options: { cwd?: string; template?: "minimal" | "standard"; directory?: string } = {}): CreatedQiyProject {
  if (!isValidProjectName(name)) throw new Error(`Invalid project name "${name}": use lowercase letters, digits and single hyphens (for example: shop, inventory-admin).`);
  const template = options.template ?? "standard";
  const root = resolve(options.cwd ?? process.cwd(), options.directory ?? name);
  if (existsSync(root) && readdirSync(root).length > 0) throw new Error(`Target directory is not empty: ${root}. Choose another name or an empty directory.`);
  const files: Record<string, string> = {
    [QIY_PROJECT_FILE]: `${JSON.stringify({ formatVersion: 1, name, template, model: "model/app.qiy", output: "admin" } satisfies QiyProjectManifest, null, 2)}\n`,
    "README.md": sharedReadme(name),
    ".gitignore": gitignore,
    "model/app.qiy": appModel(name, template),
    "model/modules/10-catalog.qiy": template === "minimal" ? minimalCatalog : standardCatalog,
    "model/modules/README.md": `# Model modules\n\nEach file is an \`application\` fragment included by \`model/app.qiy\`. Keep the Qiy declaration order:\n\n\`database → config → messages → permissions → enums → entities → relations → scope/restrict/pages → menu → charts → dataflows → actions\`\n\nStart with \`10-catalog.qiy\` and split by business domain as the model grows. Optional examples live in \`40-permissions.qiy\`, \`50-dataflows.qiy\` and \`60-messages.qiy\`; uncomment them and add the matching \`include\` to \`model/app.qiy\` when needed.\n`,
    "model/modules/40-permissions.qiy": permissionsSample,
    "model/modules/50-dataflows.qiy": dataflowSample,
    "model/modules/60-messages.qiy": messagesSample,
  };
  if (template !== "minimal") {
    files["model/modules/20-relations.qiy"] = relations;
    files["model/modules/30-ui.qiy"] = ui;
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { root, files: Object.keys(files) };
}
