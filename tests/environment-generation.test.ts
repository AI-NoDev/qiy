import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import { prepareEnvironmentFile } from "../tools/environment-files";

const source = `qiy v0;
application qiy-env-check {
  database postgresql {}
  api { client graphql; }
  elysia { jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; } }
  storage { provider s3; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  env {
    variable PUBLIC_API_URL {
      development "http://localhost:3000";
      production required;
      example "https://api.example.com";
    }
    variable BILLING_API_TOKEN {
      secret;
      development generate;
      production required;
      example required;
    }
    variable VITE_PUBLIC_API_URL {
      development "http://localhost:3000";
      production "https://api.example.com";
      example "https://api.example.com";
    }
  }
  enum role { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field role role;
    field passwordHash Text @nullable;
  }
}`;

test("parses env modes and generates server/web files plus mode-aware commands", () => {
  const project = parseQiyProject(source);
  expect(parseQiyProject(serializeQiyProject(project)).environment).toEqual(project.environment);
  const files = generateProject(project.database, project.name, project);
  const development = files["apps/server/.env.development"]!;
  const production = files["apps/server/.env.production"]!;
  const example = files["apps/server/.env.example"]!;

  expect(development).toContain("DATABASE_URL=postgres://qiy:qiy@127.0.0.1:5432/qiy");
  expect(development).toContain("QIY_AUTH_SECRET=__QIY_GENERATE_SECRET__");
  expect(development).toContain("QIY_ACCESS_SECRET=__QIY_GENERATE_SECRET__");
  expect(development).toContain("BILLING_API_TOKEN=__QIY_GENERATE_SECRET__");
  expect(development).toContain("PUBLIC_API_URL=http://localhost:3000");
  expect(production).toContain("DATABASE_URL=");
  expect(production).toContain("QIY_AUTH_SECRET=");
  expect(production).toContain("QIY_ACCESS_SECRET=");
  expect(production).toContain("BILLING_API_TOKEN=");
  expect(example).toContain("DATABASE_URL=postgres://USER:PASSWORD@db.example.com:5432/qiy");
  expect(example).toContain("QIY_STORAGE_PROVIDER=s3");
  expect(example).toContain("QIY_S3_SECRET_ACCESS_KEY=");
  expect(files["apps/web/.env.development"]).toContain("VITE_QIY_API_TRANSPORT=graphql");
  expect(files["apps/web/.env.development"]).toContain("VITE_PUBLIC_API_URL=http://localhost:3000");
  expect(files["apps/web/.env.production"]).toContain("VITE_QIY_API_TRANSPORT=graphql");
  expect(files["apps/web/.env.production"]).toContain("VITE_PUBLIC_API_URL=https://api.example.com");
  expect(JSON.parse(files["apps/server/package.json"]!).scripts.dev).toContain("--env-file=.env.development");
  expect(JSON.parse(files["apps/server/package.json"]!).scripts.start).toContain("--env-file=.env.production");
  expect(files["docker-compose.yml"]).toContain("./apps/server/.env.production");
});

test("environment sync preserves existing values and appends newly declared keys", () => {
  const updated = prepareEnvironmentFile(
    "# generated\nDATABASE_URL=postgres://new.example/qiy\nQIY_AUTH_SECRET=__QIY_GENERATE_SECRET__\nNEW_SETTING=on\n",
    "DATABASE_URL=postgres://private-host/qiy\nQIY_AUTH_SECRET=my-existing-secret\nCUSTOM_SETTING=keep-me\n",
  );
  expect(updated).toContain("DATABASE_URL=postgres://private-host/qiy");
  expect(updated).toContain("QIY_AUTH_SECRET=my-existing-secret");
  expect(updated).toContain("NEW_SETTING=on");
  expect(updated).toContain("CUSTOM_SETTING=keep-me");
  expect(updated).not.toContain("__QIY_GENERATE_SECRET__");
});

test("generated development secrets are random and production samples are blank", () => {
  const project = parseQiyProject(source);
  const files = generateProject(project.database, project.name, project);
  const dev = prepareEnvironmentFile(files["apps/server/.env.development"]!);
  expect(dev).toMatch(/QIY_AUTH_SECRET=[a-f0-9]{64}/);
  expect(dev).toMatch(/BILLING_API_TOKEN=[a-f0-9]{64}/);
  expect(files["apps/server/.env.production"]).toContain("QIY_AUTH_SECRET=\n");
});

test("rejects literal secrets, invalid modes, and duplicate env declarations", () => {
  const prefix = "qiy v0; application env-invalid { database sqlite {}";
  expect(() => parseQiyProject(`${prefix} env { variable API_KEY { secret; production \"leak\"; } } }`)).toThrow("secret variables cannot contain literal values");
  expect(() => parseQiyProject(`${prefix} env { variable SAMPLE_VALUE { development generate; } } }`)).toThrow("generate is only allowed for secret development values");
  expect(() => parseQiyProject(`${prefix} env { variable apiKey { production required; } } }`)).toThrow("uppercase letters");
  expect(() => parseQiyProject(`${prefix} env { variable API_KEY { secret; production required; } variable API_KEY { secret; example required; } } }`)).toThrow("Duplicate environment variable");
});
