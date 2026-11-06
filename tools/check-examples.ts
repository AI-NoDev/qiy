import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const write = process.argv.includes("--write");
const examples = readdirSync(join(root, "examples"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, "examples", entry.name, "admin/.qiy-generated.json")))
  .map((entry) => entry.name)
  .sort();

async function generate(model: string, output: string): Promise<void> {
  const child = Bun.spawn([process.execPath, join(root, "tools/cli.ts"), "generate", model, output], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`qiy generate ${model} failed (${code})\n${stdout}\n${stderr}`);
}
const normalize = (file: string, text: string) => {
  const lf = text.replace(/\r\n/g, "\n");
  return /(^|\/)\.env(\.|$)/.test(file) ? lf.replace(/^(\w*(?:SECRET|TOKEN|PASSWORD)\w*)=.*$/gm, "$1=<generated>") : lf;
};
const manifestFiles = (directory: string): string[] => existsSync(join(directory, ".qiy-generated.json"))
  ? [".qiy-generated.json", ...(JSON.parse(readFileSync(join(directory, ".qiy-generated.json"), "utf8")).files as string[])]
  : [];

const drift: string[] = [];
for (const name of examples) {
  const committed = join(root, "examples", name, "admin");
  const fresh = mkdtempSync(join(tmpdir(), `qiy-example-${name}-`));
  try {
    await generate(`examples/${name}/app.qiy`, fresh);
    const expected = new Set(manifestFiles(fresh));
    const actual = new Set(manifestFiles(committed));
    const changed: string[] = [];
    for (const file of expected) {
      const target = join(committed, file);
      if (!existsSync(target)) changed.push(`${file}: missing`);
      else if (normalize(file, readFileSync(target, "utf8")) !== normalize(file, readFileSync(join(fresh, file), "utf8"))) changed.push(`${file}: outdated`);
      else continue;
      if (write) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(fresh, file), target);
      }
    }
    for (const file of actual) {
      if (expected.has(file)) continue;
      changed.push(`${file}: no longer generated`);
      if (write && existsSync(join(committed, file))) unlinkSync(join(committed, file));
    }
    if (write) console.log(`examples/${name}/admin: ${changed.length} file(s) updated`);
    else drift.push(...changed.map((line) => `examples/${name}/admin/${line}`));
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
}
if (drift.length) {
  console.error(`${drift.length} generated example file(s) drifted from the generator:\n${drift.map((line) => `  ${line}`).join("\n")}\nRun \`bun run examples:sync\` and commit the result.`);
  process.exit(1);
}
if (!write) console.log(`Generated examples match the generator: ${examples.join(", ")}`);
