#!/usr/bin/env bun
import { exportMpsIr } from "./commands/export-ir";
import { exportQiy } from "./commands/export-qiy";
import { generateApp } from "./commands/generate-app";
import { generateDrizzle } from "./commands/generate-drizzle";
import { initApp } from "./commands/init";
import { validateMpsModels } from "./commands/validate-mps";

const VERSION = "0.1.0";

const USAGE = `qiy ${VERSION} - model-driven full-stack application generator

Usage: qiy <command> [options]

Commands:
  create -f <source> -n <name> -o <output-dir>
                                  Create a standalone Bun Turborepo workspace
  generate <source> <output-dir>   Generate a Bun workspace from a Qiy model
    <source>                      .qiy project (supports relative include fragments), .mps model, or Database IR .json
    --sync                        Update an existing generated workspace

  init -f <source> [-n <name>] [--sync]
                                  Mount a Qiy admin into the current Bun workspace

  validate <model.mps> [...]      Validate MPS models against the Qiy structure
  export-ir <model.mps>           Print Database IR JSON for an MPS model
  export-qiy <model.mps> <out>   Export an MPS model as .qiy source
    --force                       Overwrite an existing output file
  drizzle <ir.json|model.mps>     Print the Drizzle PostgreSQL schema

Options:
  -h, --help                     Show this help
  -v, --version                  Show the Qiy version

Environment:
  QIY_ROOT                       Qiy checkout used to resolve languages/qiy/models

Examples:
  qiy generate examples/catalog/app.qiy out/catalog-admin
  qiy create -f examples/catalog/app.qiy -n catalog-admin -o out/catalog-admin
  qiy init -f admin.qiy -n admin
  qiy generate examples/erpadmin/app.qiy out/erpadmin --sync
  qiy export-qiy languages/qiy.sandbox/models/qiy.erpworkflow.mps out/erpadmin.qiy
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
    case "validate": {
      if (!positional.length) throw new Error("qiy validate requires at least one .mps model.\n\n" + USAGE);
      await validateMpsModels(positional);
      return;
    }
    case "export-ir": {
      const [source] = positional;
      if (!source) throw new Error("qiy export-ir requires a .mps model.\n\n" + USAGE);
      process.stdout.write(await exportMpsIr(source));
      return;
    }
    case "export-qiy": {
      const [source, destination] = positional;
      if (!source || !destination) throw new Error("qiy export-qiy requires <model.mps> and <output.qiy>.\n\n" + USAGE);
      await exportQiy(source, destination, flag(rest, "--force"));
      return;
    }
    case "drizzle": {
      const [source] = positional;
      if (!source) throw new Error("qiy drizzle requires an IR .json or .mps model.\n\n" + USAGE);
      process.stdout.write(await generateDrizzle(source));
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
