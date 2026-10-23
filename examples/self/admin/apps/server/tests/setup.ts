Bun.env.DATABASE_URL ??= ":memory:";
Bun.env.QIY_STORAGE_PROVIDER = "local";
Bun.env.QIY_STORAGE_METADATA = "memory";
Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
Bun.env.QIY_REALTIME_DISABLED = "1";
