import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface StorageProvider {
  save(key: string, data: Blob): Promise<void>;
  open(key: string): Blob;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, method?: "GET" | "PUT"): string | null;
  /** Every stored object key. Used by orphan scanning; implementations bound their own page count. */
  list(): Promise<string[]>;
}

export function storageKey(key: string): string {
  const segments = key.split("/");
  if (!key || segments.some((segment) => !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(segment))) {
    throw new Error("Invalid storage key");
  }
  return segments.join("/");
}

export function createLocalStorage(root: string): StorageProvider {
  const directory = resolve(root);
  const pathFor = (key: string) => resolve(directory, storageKey(key));
  return {
    async save(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, data);
    },
    open(key) { return Bun.file(pathFor(key)); },
    async exists(key) { return Bun.file(pathFor(key)).exists(); },
    async delete(key) {
      try { await unlink(pathFor(key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
    signedUrl(key) { storageKey(key); return null; },
    async list() {
      const keys: string[] = [];
      const walk = async (current: string): Promise<void> => {
        const entries = await readdir(current, { withFileTypes: true }).catch(() => [] as never[]);
        for (const entry of entries as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
          const path = join(current, entry.name);
          if (entry.isDirectory()) await walk(path);
          else if (entry.isFile()) keys.push(relative(directory, path).split(sep).join("/"));
        }
      };
      await walk(directory);
      return keys;
    },
  };
}

export function createS3Storage(options: Bun.S3Options): StorageProvider {
  if (!options.bucket) throw new Error("S3 bucket is required");
  const client = new Bun.S3Client(options);
  return {
    async save(key, data) { await client.write(storageKey(key), data); },
    open(key) { return client.file(storageKey(key)); },
    async exists(key) { return client.exists(storageKey(key)); },
    async delete(key) { await client.unlink(storageKey(key)); },
    signedUrl(key, method = "GET") { return client.presign(storageKey(key), { method, expiresIn: 300 }); },
    async list() {
      // Bounded paging so a misconfigured bucket cannot make this scan unbounded.
      const keys: string[] = [];
      let token: string | undefined;
      for (let page = 0; page < 20; page++) {
        const response = await client.list({ prefix: "", maxKeys: 1000, ...(token ? { continuationToken: token } : {}) });
        for (const item of response.contents ?? []) if (item.key) keys.push(item.key);
        if (!response.isTruncated || !response.nextContinuationToken) break;
        token = response.nextContinuationToken;
      }
      return keys;
    },
  };
}

export function createStorageFromEnv(): StorageProvider {
  const provider = Bun.env.QIY_STORAGE_PROVIDER ?? "local";
  if (provider === "local") return createLocalStorage(Bun.env.QIY_STORAGE_ROOT ?? resolve(import.meta.dir, "../../../../storage"));
  if (provider === "s3") return createS3Storage({
    bucket: Bun.env.QIY_S3_BUCKET ?? "",
    region: Bun.env.QIY_S3_REGION,
    endpoint: Bun.env.QIY_S3_ENDPOINT,
    accessKeyId: Bun.env.QIY_S3_ACCESS_KEY_ID,
    secretAccessKey: Bun.env.QIY_S3_SECRET_ACCESS_KEY,
    sessionToken: Bun.env.QIY_S3_SESSION_TOKEN,
  });
  throw new Error(`Unsupported storage provider ${provider}`);
}
