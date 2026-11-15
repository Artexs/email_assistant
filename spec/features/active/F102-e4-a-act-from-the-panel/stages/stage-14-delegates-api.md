# F102 stage 14 — Delegates API

Part of [`../plan.md`](../plan.md). Read P4, P6, D10 and [`../commands.md`](../commands.md). Needs stage 01 landed.

Two steps: the flag and the service, then the routes.

## Step 1 — Flag and `updateDelegate`

- **Goal:** the new flag exists, and an owner can change a delegate's name, tags and active state through one service function.
- **Files:** `packages/core/src/features.ts` (and its test), module `delegation` (`service.ts`, the repository), the audit event list if needed, tests.
- **Interfaces:**
  - Flag `delegation_pages`: `{ default: false, description: "The delegates and delegations pages in the panel.", epic: "E4-A", removeBy: "2027-03-01" }`, after `approvals_page` in the registry.
  - `updateDelegate(db, ctx, input: { id, name?, tags?, active?, actor, via: "web" | "cli", now })` → `{ kind: "changed" | "same" | "not_found" } | { kind: "invalid"; field: "name" | "tags" }`.
  - `addDelegate` gains `via` in its input (audit data); the CLI passes `cli`.
- **Decisions:**
  - D10: the address never changes (a new delegate instead, as the CLI rule says). The name and tag rules of `addDelegate` apply (one shared check).
  - One audit row `delegate.changed` per call that changes something, data `{ delegate_id, fields: [<changed field names>], active?, via }`: field names only, never the old or new name or tags.
  - `setDelegateState` stays for the CLI and calls `updateDelegate`.
  - A disabled delegate keeps its open delegations (the existing rule); the classifier stops offering it (no change).
- **Test** (integration; O1, delegate Anna `anna@example.com`, tags `finance`):
  - T1: name `Anna Nowak-Lis` and tags `finance, Budget ` → `changed`; stored tags `["finance", "budget"]`; one audit row with `fields` `["name", "tags"]` and `via` `web`.
  - T2: the same values again → `same`; no audit row.
  - T3: a name of 101 characters → `invalid` / `name`; 11 tags → `invalid` / `tags`.
  - T4: `active: false` → `changed`; `delegates:list` (CLI) no longer shows Anna; `--all` does.
  - T5: an id of O2 → `not_found`.
  - T6: `featureKeys` holds `delegation_pages`; its default is off.
- **Done when:** T1–T6 pass; the existing delegate CLI tests pass.

## Step 2 — Routes

- **Goal:** the panel lists, adds and changes delegates.
- **Files:** a new `packages/core/src/web/delegation.ts` (the `Delegate` schema and the bodies), a new router file in module `delegation` (`delegateRoutes`), the server web wiring, tests.
- **Interfaces:** `GET /api/delegates`, `POST /api/delegates`, `PATCH /api/delegates/:id` (shapes and answers in `commands.md`), each with `apiDoc` (tag `delegates`; `listDelegates`, `addDelegate`, `updateDelegate`).
- **Decisions:**
  - P4: flag `delegation_pages` off → 404 `not_found` on all three. P6: `GET` for any member; `POST`, `PATCH` owner only (`requireOwner`).
  - `GET` returns all delegates (active first, then by name), at most 200.
  - `POST` maps `exists` → 409, `mailbox_address` → 400, `invalid` → 400 `validation` with the field.
  - `PATCH` needs at least one of `name`, `tags`, `active` (else 400 `validation`); `not_found` → 404; `same` → 200 with the delegate.
- **Test** (integration):
  - T7: flag off → 404 on all three.
  - T8: a member reads the list (200) and gets 403 `owner_only` on `POST` and `PATCH`.
  - T9: `POST` `{ name: "Piotr Lis", email: "Piotr@Example.com", tags: ["it"] }` → 201 with `email` `piotr@example.com`; again → 409 `exists`.
  - T10: `POST` with the address of a mailbox of O1 → 400 `mailbox_address`.
  - T11: `PATCH` with `{}` → 400 `validation`; with `{ active: false }` → 200, `active` false.
  - T12: an id of O2 → 404 on `PATCH`.
  - T13: the route test of stage 01 lists the three routes as described.
- **Done when:** T7–T13 pass.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s14`).
