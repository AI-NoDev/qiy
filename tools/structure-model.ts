import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { QIY_STRUCTURE_MODEL } from "./admin-template.data";

const RELATIVE_PATH = "languages/qiy/models/qiy.structure.mps";
const INLINE_PREFIX = "qiy-inline:";

/**
 * Resolves `qiy.structure.mps` for both `bun run tools/*.ts` and the compiled
 * `qiy` executable. A standalone binary has no `import.meta.url` to resolve
 * against, so the repository checkout (or a QIY_ROOT override) is used.
 */
export function structureModelPath(): string {
  const override = process.env.QIY_ROOT;
  const moduleDir = import.meta.dir;
  const candidates = [
    override ? join(resolve(override), RELATIVE_PATH) : undefined,
    join(process.cwd(), RELATIVE_PATH),
    moduleDir ? join(dirname(moduleDir), RELATIVE_PATH) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  if (QIY_STRUCTURE_MODEL.length > 0) return INLINE_PREFIX;
  throw new Error(
    `Cannot locate ${RELATIVE_PATH}, and no inlined snapshot is available. Reinstall Qiy or set QIY_ROOT to a Qiy checkout.`,
  );
}

export async function readStructureModel(): Promise<string> {
  const path = structureModelPath();
  return path === INLINE_PREFIX ? QIY_STRUCTURE_MODEL : await Bun.file(path).text();
}
