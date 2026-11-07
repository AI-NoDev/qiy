# Migrating to 0.38

0.38 keeps one way to do each thing: the built-in ERP order slice `workflow orderInventory;` is removed in favor of the general [state machine](/en/guide/business-logic#state-machines). A model that still declares it fails to parse with a pointer to this guide.

| Change | Replacement | Impact |
| --- | --- | --- |
| `workflow orderInventory;` | `statemachine` | Rewrite the model, regenerate, migrate |
| Generated `createApp(repositories, authenticate, includeWorkflows, includeStorage, …)` | The third argument is gone | Only hand-written code that calls `createApp` |
| A `read` role in a dataflow's `allow roles` | Remove the role | Parse error |
| `@computed` calculated in API responses | Database generated column | Regenerate and migrate; the model is unchanged |
| Dataflows rejected resources with `restrict` | Dataflows apply the policy | Regenerate; no model change |

Steps:

1. Rewrite the model as described below and run `qiy check` until it passes.
2. Regenerate with `qiy generate` (or `qiy generate app.qiy <dir> --sync`). Files of the removed workflow are deleted by `--sync`.
3. Run `bun run db:generate` in `apps/server`, review the migration, then `bun run db:migrate` (`db:migrate:production` in production).

## workflow orderInventory

Replace `workflow orderInventory;` with a state machine after your charts. This is equivalent to the four actions 0.37 generated:

```qiy
statemachine orderLifecycle {
  resource orders;
  field status;
  initial draft;
  transition submit { from draft; to submitted; label "Submit order"; }
  transition approve { from submitted; to approved; label "Approve"; allow roles admin; }
  transition ship { from approved; to shipped; label "Ship"; confirm "Ship this order?"; }
  transition cancel { from draft, submitted; to cancelled; label "Cancel order"; confirm "Cancel this order?"; }
}
```

| 0.37 `orderInventory` | 0.38 `statemachine` |
| --- | --- |
| `POST /api/v1/orders/:id/submit` (and approve, ship, cancel) | `POST /api/v1/commands/orderLifecycleSubmit` with `{ "recordId": "<id>" }`; GraphQL `runOrderLifecycleSubmit` |
| Only submit required an `Idempotency-Key`, stored in `order_idempotency` | Every transition requires one, stored in `dataflow_idempotency` |
| Audit actions `order.submitted`, `order.approved`, … | `orders.submit`, `orders.approve`, … plus an outbox event |
| The `OrderWorkflowActions` detail component | Generic list and detail buttons, shown per state |
| PostgreSQL only, fixed entity and field names | Any dialect, any required enum field |
| Approval wrote `approvedBy` | Use `audit_events.actorId`, or a dataflow of your own |
| Stock reserved on submit, deducted on ship, released on cancel | Not generated any more; see below |

The `status` field can now only change through transitions: create, edit, CSV import and the forms no longer accept it, and new orders start in the `initial` state.

### Stock reservation

The inventory logic was hard-wired for the ERP example and could not be expressed in the model, so it was removed with the slice. For a single-row write such as "deduct on ship", declare a dataflow that checks the stock row with `require` and writes it with `update`, and show its action with `when status == "approved"`. For allocation across several rows, implement it in your own code or behind a dataflow `call` adapter.

## Database

After regenerating, `order_reservations` and `order_idempotency` leave the schema, and the generated migration drops them; export their data first if you need it. `orders.status` gains a database default (the initial state). Existing orders keep their state and can continue through the new transitions.

## createApp

```ts
// 0.37
await createApp(repositories, authenticate, false, false);
// 0.38
await createApp(repositories, authenticate, false);
```

Generated tests are already updated; only hand-written tests or scripts that pass positional arguments need the change.

## Command transport

The generated data provider's `custom({ method: "post" })` only accepts declared command URLs (`/api/v1/commands/<name>` and `/batch`); anything else throws `Unknown command` (0.37: `Unknown workflow command`).

## Computed fields

`@computed` fields are now generated columns (STORED on PostgreSQL, VIRTUAL on MySQL and SQLite). The migration adds one column per computed field, and the database fills existing rows.

- Computed fields can be sorted, filtered, indexed and selected by views.
- Decimal and Money results are rounded to the declared scale and returned as strings on PostgreSQL and MySQL, like other decimal fields; 0.37 returned unrounded numbers.
- Numeric expressions always divide as decimals. Integer results still truncate toward zero; a null reference or a zero divisor still yields null.
- `db:restore` skips generated columns; the database recomputes them.

## Dataflow roles

`allow roles` is checked against each role's access level at parse time. A `read` role (`viewer` in the default model) fails with `Dataflow <name>: role viewer has read access and cannot run commands`. Remove it; read-only roles could never run commands.

## Dataflows and record policies

Dataflows and transitions may now use resources with a `restrict` block, which generation used to reject. The policy applies to every record a command loads or writes; see [record policies](/en/guide/auth-permissions#record-policies).
