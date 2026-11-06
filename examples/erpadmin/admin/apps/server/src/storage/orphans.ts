import { scanOrphanAttachmentObjects } from "./routes";

const dryRun = !Bun.argv.includes("--apply");
const limit = Number(Bun.env.QIY_ATTACHMENT_ORPHAN_LIMIT ?? 1000);
try {
  const result = await scanOrphanAttachmentObjects({ dryRun, limit });
  console.log(JSON.stringify(result));
  if (result.orphans.length) console.log("orphan objects: " + result.orphans.join(", "));
  if (result.truncated) console.log("more orphans exist than the --limit/retention window; re-run after applying");
  if (result.missingObjects) console.log("metadata rows without an object: " + result.missingObjects + " (run attachments:cleanup to remove them)");
  if (dryRun && result.orphans.length) console.log("dry run: nothing was deleted. Re-run with --apply after reviewing the list.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
