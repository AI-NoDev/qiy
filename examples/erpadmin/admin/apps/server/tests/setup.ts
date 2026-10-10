Bun.env.DATABASE_URL ??= "postgres://qiy:qiy@127.0.0.1:5432/qiy_test";
Bun.env.QIY_STORAGE_PROVIDER = "local";
Bun.env.QIY_STORAGE_METADATA = "memory";
Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
Bun.env.QIY_AUTH_SECRET ??= "qiy-local-auth-test-secret-value-32";
