# Authentication and permissions

Access control in Qiy has four layers. Each one fails closed: a missing claim, an unknown role or an unsatisfied rule denies the request.

| Layer | Declaration | Question it answers |
| --- | --- | --- |
| Authentication | `auth { … }` | Who is calling, and which role and claims do they carry? |
| Permissions | `permission field`, `permission group`, `permission from`, `permission verification` | Which permission values does the caller hold? |
| Records | `scope`, `restrict` | Which rows and fields may the caller see or write? |
| Pages and commands | `pages`, `allow` on dataflows, transitions and actions | May the caller open this page or run this command? |

## A complete model

```qiy
qiy v0;

application support-desk {
  database sqlite {}

  auth {
    provider local;
    user users;
    roleField role;
    usernameField email;
    passwordField passwordHash;
    roles {
      owner full;
      agent write;
      auditor read;
    }
    claim org.id orgId;
  }

  permission field TicketExportPermission "tickets:export" @label("Export tickets");
  permission group owner { TicketExportPermission }
  permission from database field users.permissions;

  enum role { value owner; value agent; value auditor; }

  entity organizations {
    field id UUID @id;
    field name Text;
    field parentId UUID @nullable;
  }

  entity users {
    field id UUID @id;
    field email Email @unique;
    field passwordHash Text @nullable;
    field role role;
    field orgId UUID @nullable;
    field permissions Text @nullable;
  }

  entity tickets {
    field id UUID @id;
    field title Text;
    field queue Text;
    field ownerId UUID;
    field orgId UUID;
    field internalNote Text @nullable;
  }

  relation organizationParent organizations parentId organizations id one @onDelete(setNull);
  relation ticketOrganization tickets orgId organizations id one @onDelete(restrict);

  scope tickets orgId claim org.id tree organizations parentId;

  restrict tickets {
    allow roles owner, agent, auditor;
    when queue in "support", "billing";
    mask internalNote roles auditor mode omit;
  }

  pages tickets {
    delete roles owner;
  }
}
```

## Authentication

```qiy
auth {
  provider local;
  user users;
  roleField role;
  usernameField email;
  passwordField passwordHash;
}
```

- `provider local` signs users in with a password stored in `passwordField`. `provider oidc` (or a list such as `providers local, okta, corp;` with one `provider <name> { … }` block each) adds OAuth/OIDC sign-in; presets cover common identity providers.
- `user` names the user entity; `roleField` must be an enum field on it. `subjectField` stores the external subject for OAuth/OIDC users.
- There is no self-registration. Create the first administrator with `bun run auth:bootstrap-admin` in `apps/server`; sessions are signed with `QIY_AUTH_SECRET` (at least 32 characters in production).
- `claim <claim> <field>;` maps a claim that `scope` or `@tenant` uses to a column on the user entity, for local and hybrid sign-in.

The full provider matrix, environment variables and callback URLs are in the Chinese [auth reference](/dsl/auth).

### Roles

```qiy
roles {
  owner full;
  agent write;
  auditor read;
}
```

Each role has an access level: `full` roles reach every resource, the user table, audit history and import/export; `write` roles get CRUD on business resources; `read` roles get list and show. The `roleField` enum must list exactly these roles. The first `full` role is the bootstrap admin. Without a `roles` block the roles are `admin full; operator write; viewer read;`.

## Permissions

```qiy
permission field TicketExportPermission "tickets:export" @label("Export tickets");
permission group Support { TicketExportPermission }
permission group owner { Support }
permission from database field users.permissions;
permission from claim corp "roles";
permission verification CanExport {
  return self.role = "owner" || self.role = "agent";
}
```

- A `permission field` declares a permission value, conventionally `<domain>:<action>`.
- A `permission group` collects fields and other groups. A group named after a role grants its permissions to everyone with that role. `A & B` is a union; there is no subtraction.
- `permission from database field` and `permission from claim` add values held by an individual user.
- A `permission verification` is a named boolean check over `self` (the caller) and optional inputs.
- Permission declarations sit right after `messages` and before `enum`, in one contiguous run.

Commands, transitions and actions reference these with `allow roles …`, `allow permission …` or `allow verification …`.

## Data scopes

```qiy
scope tickets orgId claim org.id;
scope tickets orgId claim org.id tree organizations parentId;
```

A scope filters every read and forces every write of a resource to the caller's claim value. With `tree`, a caller also sees records of descendant organizations. A request without the claim gets 403; a record outside the scope is 404. `field tenantId UUID @tenant("tenant.id");` on an entity is the shorthand for a tenant scope.

## Record policies

```qiy
restrict tickets {
  allow roles owner, agent, auditor;
  when ( scope or ownerId claim user.id );
  when queue in "support", "billing";
  mask internalNote roles auditor mode omit;
}
```

- `allow roles` limits which roles may use the resource at all (403 otherwise).
- Each `when` adds a row condition that is pushed down to SQL: literal comparisons (`==`, `!=`, `in`, `notIn`), `<field> claim <claim>` against the caller, cross-field comparisons (`when endsAt >= field startsAt`), `scope`, and `and`/`or`/`not` with parentheses. All `when` rows must hold. A missing claim is 403 `policy.missingClaim`, never "everything visible".
- `mask <field> roles … | claim absent <claim> mode omit|null|redact [replacement "…"]` hides a field from some callers. Masks work both ways: those callers get 400 `policy.maskedField` when writing or importing the field. `mask` is the only field rule that protects data.

Policies apply everywhere the resource is reached: lists, details, updates, deletes, exports, views, GraphQL, realtime and dataflows. A dataflow loads context records under the caller's policy (a hidden record is 404), re-checks every row it writes inside the same transaction (403 `policy.outsideScope`, rolled back) and masks its result. Generation rejects a dataflow that writes a masked field, reads one in an `emit` or `call` payload, or writes a literal that a `when` row excludes.

## Page rules

```qiy
pages tickets {
  list roles owner, agent, auditor;
  create roles owner, agent;
  delete roles owner;
  field internalNote roles owner;
}
```

`pages` narrows which roles may list, show, create, edit or delete a resource. The server guard applies the same table to REST (including export and import) and GraphQL, and the web access-control provider uses it for menus and buttons, so the UI and the 403 responses agree. Actions you leave out are only limited by `restrict` and the role levels. `field … roles` only changes rendering; protect the data itself with `restrict … mask`.

The complete grammar, the generated files and every error message are in the Chinese [permissions reference](/dsl/permissions).
