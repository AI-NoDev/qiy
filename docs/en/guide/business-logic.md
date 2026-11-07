# Business logic

CRUD covers most of an admin. For the rest, Qiy has four declarations that compile to transactional, tested server code and matching UI:

| Need | Declaration |
| --- | --- |
| A record moves between a fixed set of states, with a button per allowed move | `statemachine` |
| One command that checks conditions and writes several records in one transaction | `dataflow` |
| A button on a list or detail page that runs a command or opens your own page | `action` |
| Tell other systems or people when something happened | `webhook`, `notification` |
| Run a command on a schedule | `elysia { cron { job … dataflow …; } }` |

## A complete model

```qiy
qiy v0;

application service-desk {
  database sqlite {}

  elysia {
    cron {
      job morningDigest pattern "0 7 * * 1-5" dataflow postDigest;
    }
  }

  notifications {
    provider smtp;
    from "Service Desk <desk@example.com>";
  }

  auth {
    provider local;
    user users;
    roleField role;
    usernameField email;
    passwordField passwordHash;
  }

  enum role { value admin; value operator; value viewer; }
  enum ticketStatus { value open; value resolved; value closed; }

  entity users {
    field id UUID @id;
    field email Email @unique;
    field passwordHash Text @nullable;
    field role role;
  }

  entity tickets {
    field id UUID @id;
    field title Text;
    field contactEmail Email;
    field status ticketStatus;
    field resolution Text @nullable;
  }

  entity digests {
    field id UUID @id;
    field title Text;
  }

  statemachine ticketLifecycle {
    resource tickets;
    field status;
    initial open;
    transition close { from resolved; to closed; label "Close"; allow roles admin; }
    transition reopen { from resolved, closed; to open; label "Reopen"; confirm "Reopen this ticket?"; }
  }

  dataflow resolveTicket @label("Resolve") @confirm("Resolve this ticket?") {
    allow roles admin, operator;
    idempotency required;
    audit "ticket.resolved";
    input {
      field ticketId UUID @required;
      field resolution Text @required;
    }
    context {
      ticket = entity tickets by id input.ticketId @required;
    }
    step check @order(10) {
      require ticket.status == "open" @error("Only open tickets can be resolved");
    }
    step resolve @order(20) {
      update ticket { resolution = input.resolution; }
      emit "ticket.resolved" { ticketId = ticket.id; contactEmail = ticket.contactEmail; }
    }
    result { return ticket; }
  }

  dataflow postDigest {
    allow roles admin;
    idempotency required;
    input { }
    context { }
    step post {
      create digest = entity digests { title = "Morning digest"; }
    }
    result { return digest; }
  }

  action resolveTicket {
    resource tickets;
    dataflow resolveTicket;
    placement list, show;
    when status == "open";
  }

  webhook ticketFeed {
    event "ticket.resolved", "tickets.close";
    url env TICKET_WEBHOOK_URL;
    secret env TICKET_WEBHOOK_SECRET;
  }

  notification resolvedMail {
    event "ticket.resolved";
    to payload.contactEmail;
    subject "Your ticket was resolved";
    body "Ticket {ticketId} has been resolved. Reply to this email to reopen it.";
  }
}
```

This example keeps `status` and `resolution` apart on purpose: a state machine owns its field, so a dataflow may not write `status`. Resolving is a separate command here, and the `when status == "open"` on the action decides when its button appears.

## State machines

```text
statemachine <Name> {
  resource <entity>;
  field <enum field>;
  initial <state>;
  transition <name> {
    from <state>, …;
    to <state>;
    [label "…";] [confirm "…";]
    [allow roles … | allow permission … | allow verification <Name>;]
  }
}
```

- The field must be a required enum field. It belongs to the machine: create, update, CSV import and the forms no longer accept it, and new records start in `initial`.
- Each transition becomes the command `POST /api/v1/commands/<machine><Transition>` (here `ticketLifecycleClose`) with body `{ "recordId": "<id>" }`, the GraphQL mutation `run<Machine><Transition>`, and a button that only appears in a `from` state.
- The command locks the row, returns 409 `state.invalidTransition` when the record is not in a `from` state, writes an audit row `<table>.<transition>` and emits the event `<table>.<transition>` with `{ id, <field> }`. Transitions require an `Idempotency-Key`, so retrying a click replays the first result.
- Without `allow`, every `full` and `write` role may run a transition.

## Dataflows

A dataflow is a closed, statically checked, single-transaction command:

- `allow` picks who may run it: `roles` (only `full` or `write` roles), `permission` or `verification`. Without it, every `full` and `write` role may.
- `idempotency required` makes clients send an `Idempotency-Key` header; a retry with the same key and body replays the stored response, and the same key with a different body is 409.
- `audit "<action>"` writes an `audit_events` row in the same transaction.
- `input` declares the request body; `context` loads records by primary key (`@required` turns a missing record into 404).
- Steps run in `@order`. Statements are `require <condition> @error("…")`, `update <binding> { field = value; }`, `create <binding> = entity <entity> { … }`, `delete <binding>`, `emit "<event>" { … }` and `call <adapter> { … }`. A `call` runs a synchronous handler you write in `apps/server/src/extensions/dataflow-calls.ts` inside the transaction; it fails closed until implemented, and `{ ok: false }` answers 409. Use it for in-process checks, not for irreversible side effects such as payments or HTTP calls; use `emit` plus a webhook for those.
- `result { return <binding>; }` returns one record.

Each dataflow becomes `POST /api/v1/commands/<name>` (and `/batch` when an action sets `batch true`), a GraphQL `run<Name>` mutation, an OpenAPI operation, and generated tests for idempotent replay, rollback and denied access. Record policies (`restrict`) and data scopes apply to every record a command loads or writes; see [Authentication and permissions](/en/guide/auth-permissions#record-policies).

## Actions

```qiy
action resolveTicket {
  resource tickets;
  dataflow resolveTicket;
  placement list, show;
  when status == "open";
}

action ticketHistory {
  resource tickets;
  placement show;
  label "History";
  navigate "/tickets/:id/history";
  page manual @comment("Audit timeline");
}
```

An action is a button on the list and/or detail page. With `dataflow` it opens a form for the command's remaining inputs, sends the idempotency key and refreshes the record; `label` and `confirm` default to the dataflow's `@label` and `@confirm`. `when <field> ==|!=|in …` controls when it shows. `batch true` runs the command on every selected row. With `navigate` and `page manual`, Qiy generates the route and leaves the page for you to write under `apps/web/app/extensions/`.

## Webhooks and notifications

Events come from `emit` in dataflows and from state machine transitions (`<table>.<transition>`). Each subscriber gets a delivery row written in the same transaction as the business change, so a rollback sends nothing and a failed delivery never rolls back the business write. A worker in every server process claims due rows and sends them after commit, retrying with exponential backoff up to 8 attempts.

- A `webhook` POSTs JSON `{ id, event, createdAt, data }` with headers `X-Qiy-Delivery`, `X-Qiy-Event`, `X-Qiy-Timestamp` and `X-Qiy-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`. Receivers should verify the signature and de-duplicate on `X-Qiy-Delivery`.
- A `notification` sends an email through the `notifications` provider: `smtp` (`QIY_SMTP_URL`), `resend` (`QIY_RESEND_API_KEY`), `webhook` or `console`. Recipients are literal addresses or `payload.<field>`; `{field}` placeholders in the subject and body are filled from the event payload. `QIY_NOTIFY_PROVIDER` overrides the provider at runtime and defaults to `console` in development.

Missing configuration keeps deliveries pending instead of spending attempts.

## Scheduled commands

```qiy
elysia {
  cron {
    job morningDigest pattern "0 7 * * 1-5" dataflow postDigest;
  }
}
```

Set `QIY_CRON_ENABLED=1` to run jobs. Every replica may enable cron: each tick runs on exactly one instance through a lease table, as the first `full` role, with idempotency key `cron:<job>:<tick>`. Scheduled dataflows cannot have required inputs, cannot use `allow permission` or `allow verification`, and cannot touch scoped or tenant resources.

The complete grammar and error messages are in the Chinese references for [statemachine](/dsl/statemachine), [dataflow](/dsl/dataflow), [action](/dsl/actions) and [notifications](/dsl/notifications).
