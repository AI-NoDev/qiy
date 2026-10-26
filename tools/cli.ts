#!/usr/bin/env bun
import { generateApp } from "./commands/generate-app";
import { initApp } from "./commands/init";
import { formatSkillStatuses, installSkill, listSkillInstallations, uninstallSkill, updateSkill } from "./commands/skill";
import { formatDoctorReport, runDoctor } from "./commands/doctor";
import packageMetadata from "../package.json" with { type: "json" };

declare const __QIY_VERSION__: string;

const VERSION = typeof __QIY_VERSION__ === "string" ? __QIY_VERSION__ : packageMetadata.version;

const USAGE = `qiy ${VERSION} - model-driven full-stack application generator

Usage: qiy <command> [options]

Commands:
  create -f <source> -n <name> -o <output-dir>
                                  Create a standalone Bun Turborepo workspace
  generate <source> <output-dir>   Generate a Bun workspace from a Qiy model
    <source>                      .qiy project with optional relative include fragments
    --sync                        Update an existing generated workspace

  init -f <source> [-n <name>] [--sync]
                                  Mount a Qiy admin into the current Bun workspace

  doctor [--json]                 Check Bun, CLI template, and current workspace readiness
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
  qiy generate examples/catalog/app.qiy out/catalog-admin
  qiy create -f examples/catalog/app.qiy -n catalog-admin -o out/catalog-admin
  qiy init -f admin.qiy -n admin
  qiy generate examples/erpadmin/app.qiy out/erpadmin --sync
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
    case "generate": {
      const [source, destination] = positional;
      if (!source || !destination) throw new Error("qiy generate requires <source> and <output-dir>.\n\n" + USAGE);
      await generateApp(source, destination, { sync: flag(rest, "--sync") });
      return;
    }
    case "create": {
      const source = option(rest, "-f", "--file");
      const name = option(rest, "-n", "--name");
      const destination = option(rest, "-o", "--output");
      if (!source || !name || !destination) throw new Error("qiy create requires -f <source>, -n <name>, and -o <output-dir>.\n\n" + USAGE);
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
