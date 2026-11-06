Bun.env.DATABASE_URL = Bun.env.QIY_TEST_DATABASE_URL ?? ":memory:";
Bun.env.QIY_STORAGE_PROVIDER = "local";
Bun.env.QIY_STORAGE_METADATA = "memory";
Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
