#!/usr/bin/env bun
import { addEntity, addField } from "./commands/add";
import { generateApp } from "./commands/generate-app";
import { initApp } from "./commands/init";
import { checkProject, createProject, devProject, generateProject, runProjectScript } from "./commands/project";
import { explainQiyFile, formatQiyExplanation } from "./commands/explain";
import { findQiyError, formatQiyError, qiyErrorCatalog } from "./error-catalog";
import { qiyExplanationSchema } from "./qiy-schema";
import { formatSkillStatuses, installSkill, listSkillInstallations, uninstallSkill, updateSkill } from "./commands/skill";
import { formatDoctorReport, runDoctor } from "./commands/doctor";
import packageMetadata from "../package.json" with { type: "json" };

declare const __QIY_VERSION__: string;

const VERSION = typeof __QIY_VERSION__ === "string" ? __QIY_VERSION__ : packageMetadata.version;

const USAGE = `qiy ${VERSION} - model-driven full-stack application generator

Usage: qiy <command> [options]

Commands:
  create project <name> [--template minimal|standard] [--dir <path>]
                                  Create a modular Qiy project (model/ + qiy.project.json)
  generate                        Generate/sync the current project
    <source> <output-dir>         Legacy explicit generation; --sync updates it
  check                           Validate the current project model without writing
  add entity <name> [--module <name>] [--field name:Type ...] [--label ...] [--icon ...]
                                  Append an entity to a model module and validate
  add field <entity> <name:Type> [--nullable] [--unique] [--code <template>]
                                  Insert a field into an existing entity and validate
  dev [--watch]                   Generate, install on first run, start API + admin
                                  (--watch regenerates on model/ changes)
  build                           Generate/install then run the production build
  test                            Generate/install then run generated tests
  preview                         Generate/install then run the local preview
  create -f <source> -n <name> -o <output-dir>
                                  Legacy: create a standalone workspace from a model file

  init -f <source> [-n <name>] [--sync]
                                  Mount a Qiy admin into the current Bun workspace

  doctor [--json]                 Check Bun, CLI template, and current workspace readiness
  explain <file.qiy> [--json]     Print a normalized model summary without generating
    --errors [--json]             List the stable error-code catalog
  schema                          Print the JSON Schema for explain --json output
  skill install [--force] [--global] [--dir <path>]
                                  Install the official agent skill (default <project>/.agents/skills/qiy,
                                  --global writes ~/.agents/skills/qiy, --dir writes a custom directory)
  skill list [--json] [--global] [--dir <path>]
                                  Show installed skill locations and whether they are up to date
  skill update [--force] [--global] [--dir <path>]
                                  Refresh official files in an existing installation
  skill uninstall [--global] [--dir <path>]
                                  Remove official skill files (unrelated files are preserved)

Options:
  -h, --help                     Show this help
  -v, --version                  Show the Qiy version

Examples:
  qiy create project shop
  cd shop && qiy dev
  qiy check
  qiy generate
  qiy create -f examples/catalog/app.qiy -n catalog-admin -o out/catalog-admin
  qiy init -f admin.qiy -n admin
`;

function flag(args: string[], ...names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

function option(args: string[], ...names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (!names.includes(args[index]!)) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${args[index]} requires a value.`);
    return value;
  }
  return undefined;
}

function optionValues(args: string[], ...names: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (!names.includes(args[index]!)) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${args[index]} requires a value.`);
    values.push(value);
    index += 1;
  }
  return values;
}

function positionalArguments(args: string[], valueFlags: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (valueFlags.includes(argument)) { index += 1; continue; }
    if (!argument.startsWith("-")) values.push(argument);
  }
  return values;
}

async function main(argv: string[]): Promise<void> {
  const args = argv;
  if (!args.length || flag(args, "-h", "--help")) {
    console.log(USAGE);
    return;
  }
  if (flag(args, "-v", "--version")) {
    console.log(VERSION);
    return;
  }
  const [command, ...rest] = args;
  const positional = rest.filter((arg) => !arg.startsWith("-"));
  switch (command) {
    case "skill": {
      const subcommand = rest[0] ?? "";
      const usage = "Usage: qiy skill <install|list|update|uninstall> [--force] [--global] [--dir <path>] [--json]";
      if (!["install", "list", "update", "uninstall"].includes(subcommand)) throw new Error(usage);
      const skillArguments = rest.slice(1);
      const dir = option(skillArguments, "--dir");
      const allowed = subcommand === "list"
        ? ["--json", "--global", "--dir"]
        : subcommand === "install" || subcommand === "update"
          ? ["--force", "--global", "--dir"]
          : ["--global", "--dir"];
      for (let index = 0; index < skillArguments.length; index += 1) {
        const argument = skillArguments[index]!;
        if (argument === "--dir") { index += 1; continue; }
        if (!allowed.includes(argument)) throw new Error(usage);
      }
      const options = { global: flag(skillArguments, "--global"), ...(dir && { dir }) };
      if (subcommand === "install") installSkill(process.cwd(), flag(skillArguments, "--force"), options);
      else if (subcommand === "update") updateSkill(process.cwd(), flag(skillArguments, "--force"), options);
      else if (subcommand === "uninstall") {
        const result = uninstallSkill(process.cwd(), options);
        console.log(`Removed ${result.removed.length} official Qiy skill files from ${result.destination}`);
        if (result.preserved.length) console.log(`Preserved ${result.preserved.length} unrelated files: ${result.preserved.join(", ")}`);
      } else {
        const statuses = listSkillInstallations(process.cwd(), options);
        if (flag(skillArguments, "--json")) console.log(JSON.stringify(statuses, null, 2));
        else console.log(formatSkillStatuses(statuses));
      }
      return;
    }
    case "explain": {
      const json = flag(rest, "--json");
      if (rest[0] === "errors" || flag(rest, "--errors")) {
        const rows = qiyErrorCatalog.map(({ code, title, description, fix, docs }) => ({ code, title, description, fix, docs }));
        if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        else {
          process.stdout.write([
            "Qiy error codes (also at https://ai-nodev.github.io/qiy/dsl/errors)",
            "",
            ...qiyErrorCatalog.map((entry) => `${entry.code}  ${entry.title}\n  ${entry.description}\n  Fix: ${entry.fix}\n  ${entry.docs}`),
            "",
          ].join("\n"));
        }
        return;
      }
      const source = option(rest, "-f", "--file") ?? rest.find((argument) => !argument.startsWith("-"));
      if (!source) throw new Error("qiy explain requires a .qiy file (or --errors).\n\n" + USAGE);
      try {
        const explanation = await explainQiyFile(source);
        process.stdout.write(json ? `${JSON.stringify(explanation, null, 2)}\n` : formatQiyExplanation(explanation));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const known = findQiyError(message);
        if (json) {
          process.stdout.write(`${JSON.stringify({
            formatVersion: 1,
            sourceFile: source,
            valid: false,
            error: message,
            ...(known ? { code: known.code, title: known.title, fix: known.fix, docs: known.docs } : {}),
          }, null, 2)}\n`);
        } else {
          console.error(formatQiyError(message));
        }
        process.exitCode = 1;
      }
      return;
    }
    case "schema": {
      process.stdout.write(`${JSON.stringify(qiyExplanationSchema, null, 2)}\n`);
      return;
    }
    case "generate": {
      const [source, destination] = positional;
      if (!source && !destination) {
        await generateProject(process.cwd());
        return;
      }
      if (!source || !destination) throw new Error("qiy generate requires <source> and <output-dir> (or run it inside a qiy project).\n\n" + USAGE);
      await generateApp(source, destination, { sync: flag(rest, "--sync") });
      return;
    }
    case "check": {
      await checkProject(process.cwd());
      return;
    }
    case "add": {
      const kind = rest[0];
      const addArguments = rest.slice(1);
      if (kind !== "entity" && kind !== "field") throw new Error("Usage: qiy add entity <name> ... | qiy add field <entity> <name:Type> ...\n\n" + USAGE);
      const valueFlags = ["--module", "--field", "--label", "--icon", "--code"];
      const positionals = positionalArguments(addArguments, valueFlags);
      const allowed = new Set(["--module", "--field", "--label", "--icon", "--code", "--nullable", "--unique"]);
      for (let index = 0; index < addArguments.length; index += 1) {
        const argument = addArguments[index]!;
        if (valueFlags.includes(argument)) { index += 1; continue; }
        if (!argument.startsWith("-")) continue;
        if (!allowed.has(argument)) throw new Error(`Unknown qiy add option: ${argument}\n\n${USAGE}`);
      }
      const module = option(addArguments, "--module");
      const nullable = flag(addArguments, "--nullable");
      const unique = flag(addArguments, "--unique");
      const code = option(addArguments, "--code");
      if (kind === "entity") {
        const name = positionals[0];
        if (!name) throw new Error("qiy add entity requires a name.\n\n" + USAGE);
        await addEntity(name, {
          ...(module && { module }),
          ...(optionValues(addArguments, "--field").length ? { fields: optionValues(addArguments, "--field") } : {}),
          ...(option(addArguments, "--label") ? { label: option(addArguments, "--label")! } : {}),
          ...(option(addArguments, "--icon") ? { icon: option(addArguments, "--icon")! } : {}),
          ...(nullable && { nullable }),
          ...(unique && { unique }),
          ...(code && { code }),
        });
      } else {
        const entityName = positionals[0];
        const spec = positionals[1];
        if (!entityName || !spec) throw new Error("qiy add field requires <entity> and <name:Type>.\n\n" + USAGE);
        await addField(entityName, spec, { ...(nullable && { nullable }), ...(unique && { unique }), ...(code && { code }) });
      }
      return;
    }
    case "dev": {
      for (const argument of rest) {
        if (argument !== "--watch" && argument !== "-w") throw new Error("Usage: qiy dev [--watch]\n\n" + USAGE);
      }
      await devProject(process.cwd(), { watch: flag(rest, "--watch", "-w") });
      return;
    }
    case "build":
    case "test":
    case "preview": {
      await runProjectScript(command, process.cwd());
      return;
    }
    case "create": {
      if (rest[0] === "project") {
        const args = rest.slice(1);
        const valueFlags = new Set(["--template", "--dir", "-n", "--name"]);
        let projectName = option(args, "-n", "--name");
        for (let index = 0; index < args.length && projectName === undefined; index += 1) {
          const argument = args[index]!;
          if (valueFlags.has(argument)) { index += 1; continue; }
          if (!argument.startsWith("-")) projectName = argument;
        }
        if (!projectName) throw new Error("qiy create project requires a name.\n\n" + USAGE);
        const template = option(args, "--template") ?? "standard";
        if (template !== "minimal" && template !== "standard") throw new Error("qiy create project --template must be minimal or standard.");
        const directory = option(args, "--dir");
        createProject(projectName, { template, ...(directory && { directory }) });
        return;
      }
      const source = option(rest, "-f", "--file");
      const name = option(rest, "-n", "--name");
      const destination = option(rest, "-o", "--output");
      if (!source || !name || !destination) throw new Error("qiy create requires -f <source>, -n <name>, and -o <output-dir>, or use qiy create project <name>.\n\n" + USAGE);
      await generateApp(source, destination, { sync: flag(rest, "--sync"), name });
      return;
    }
    case "init": {
      const source = option(rest, "-f", "--file");
      if (!source) throw new Error("qiy init requires -f <source>.\n\n" + USAGE);
      await initApp({ source, name: option(rest, "-n", "--name"), root: option(rest, "-o", "--output"), sync: flag(rest, "--sync") });
      return;
    }
    case "doctor": {
      const report = runDoctor(process.cwd());
      process.stdout.write(flag(rest, "--json") ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "help":
      console.log(USAGE);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n` + USAGE);
  }
}

try {
  await main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
