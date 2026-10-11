import { posix } from "node:path";

export function generatedWiki(files: Record<string, string>, name: string, source: string, mounted = false): Record<string, string> {
  const web = Object.keys(files).find((path) => /^apps\/[^/]+\/package.json$/.test(path) && files[path]?.includes('"react-router"'));
  if (!web) throw new Error("Generated Web package is missing");
  const webRoot = posix.dirname(web);
  const server = Object.keys(files).find((path) => /^apps\/[^/]+\/package.json$/.test(path) && files[path]?.includes('"elysia"'));
  const wikiRoot = mounted ? `openwiki/qiy-${name}` : "openwiki";
  const entry = `${wikiRoot}/quickstart.md`;
  const agentRoot = mounted ? webRoot : ".";
  const entryLink = posix.relative(agentRoot, entry);
  const agent = `# AI development guide\n\nRead [OpenWiki quickstart](${entryLink}) first, then follow the architecture and development links.\n\nThese documents describe the generated Qiy slice, not unrelated host application code. Inspect actual source and package scripts before making changes. Never read or expose live .env credentials. Qiy --sync rewrites manifest-owned files; keep custom behavior in unowned extensions or host adapters and review regeneration diffs.\n`;
  const packageRoots = [server ? posix.dirname(server) : undefined, webRoot].filter((path): path is string => Boolean(path));
  const scripts = packageRoots.map((path) => {
    const pkg = JSON.parse(files[`${path}/package.json`]!) as { name: string; scripts?: Record<string, string> };
    return `### ${path} (${pkg.name})\n\n${Object.entries(pkg.scripts ?? {}).map(([script, command]) => `- \`${script}\`: \`${command}\``).join("\n")}`;
  }).join("\n\n");
  const sources = Object.keys(files).filter((path) => /\.(ts|tsx|json|ya?ml|md)$/.test(path) && !path.includes(".env") && !path.includes("lock")).sort();
  return {
    [posix.join(agentRoot, "AGENTS.md")]: agent,
    [posix.join(agentRoot, "AGENT.MD")]: `# AI development entry\n\nRead [AGENTS.md](AGENTS.md) and [OpenWiki quickstart](${entryLink}) before continuing development.\n`,
    [entry]: `# ${name}: generated application\n\nModel input: \`${source.replaceAll("`", "")}\`. Keep this model and all include fragments available when regenerating.\n\n${server ? "Generated slice: Refine React Router SPA, Bun/Elysia API, Drizzle schemas, tests and deployment examples." : "Generated slice: Refine React Router SPA integrated with the host API. No server, database migrations or independent authentication service is generated."}\n\n- [Architecture and source map](architecture.md)\n- [Development and regeneration](development.md)\n\nThis inventory describes generated source, not production acceptance. Real database, identity provider and storage integration require separate verification.\n`,
    [`${wikiRoot}/architecture.md`]: `# Architecture and source map\n\n${packageRoots.map((path) => `- \`${path}/\`: inspect its package scripts and source modules.`).join("\n")}\n\n${server ? "The server owns validation, authorization and database transactions; the browser is not the business authority." : "Implement existing API response mapping, login/refresh and permissions in the unowned app/host adapters."}\n\n## Generated files\n\n${sources.map((path) => `- [${path}](${posix.relative(wikiRoot, path)})`).join("\n")}\n`,
    [`${wikiRoot}/development.md`]: `# Development\n\nRun \`bun install\` at the workspace root. Available generated package commands:\n\n${scripts}\n\n## Regeneration\n\n${mounted ? `Run \`qiy init -f <model.qiy> -n ${name} --sync\` from the host root.` : "Run `qiy generate <model.qiy> <workspace-directory> --sync` from the directory containing the model."}\n\nThe manifest records generated files. Regeneration can replace owned code and documentation. Handwritten Web extensions and host adapters are preserved; keep custom documentation in separate files. Existing AGENTS.md and AGENT.MD are preserved. Check generated environment placeholders without copying production secrets into source control. Review database migrations before applying them.\n\n## AI skill\n\nRun \`qiy skill install\` from the workspace root to install the official skill, references and complete example into \`.agent/skills/qiy/\`. Reinstallation refuses changed official files unless \`--force\` is supplied. Unrelated skills are preserved.\n`,
  };
}
