import { cleanupMissingAttachmentObjects } from "./routes";

const dryRun = !Bun.argv.includes("--apply");
const result = await cleanupMissingAttachmentObjects({ dryRun, limit: Number(Bun.env.QIY_ATTACHMENT_CLEANUP_LIMIT ?? 1000) });
console.log(JSON.stringify(result));
