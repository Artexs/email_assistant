# F106 stage 02 — Module `privacy`, the delete service and `org:delete`

Part of [`../plan.md`](../plan.md). `[risky]` (data delete).

## Step 1 — module `privacy` and `deleteOrganization`

**Goal.** One service function deletes an organization; the web route (stage 03) and the CLI call it.

**Files.** New folder `apps/server/src/modules/privacy/` with `index.ts` and `delete.ts`; `modules/layers.json` (layer 5, next to `operator`); `docs/diagrams/module-graph.{md,json}` (`bun run graph:modules`); `modules/audit` (`auditEvents`).

**Interfaces.**

```ts
export type OrgDeleteResult =
  | { kind: "deleted"; mailboxAddresses: string[] }
  | { kind: "not_found" }
  | { kind: "name_mismatch" };
export async function deleteOrganization(
  db: Db,
  input: { orgId: string; confirmName: string; via: "web" | "cli" }
): Promise<OrgDeleteResult>;
```

`orgNameMatches(name: string, typed: string): boolean` (trim both, compare `toLowerCase()`; empty typed text is false) goes to `packages/core/src/web/` (pure), so the dialog of stage 04 uses the same rule.

`auditEvents` gets `orgDeleteRefused: "org.delete_refused"` (data `reason`; stage 03 writes it), `orgExported: "org.exported"` (data `tables`, `rows`; stage 05), `dsrFind: "dsr.find"` and `dsrErase: "dsr.erase"` (data `address_hash`, `counts`; stages 07, 08). One stage adds all four, so stage 09 can map them.

**Decisions.** D1, D4, D16, D17.

- In one transaction: lock the organization row (tenancy `lockOrganization` or the same `FOR UPDATE` read), `not_found` when missing; `name_mismatch` when `orgNameMatches` is false (nothing changes); read the `address` of every mailbox of the organization (sorted); call `delete_organization`. Commit.
- A deadlock (`40P01`) retries the whole transaction once, as the mailbox remove does.
- After the commit: `log.info("org_deleted", { org_id, kind: via })`. No name, no address.
- The function never runs inside a caller's transaction that stays open after it: the route answers after the commit.

**Test** (integration, `privacy-delete.test.ts`):

1. Org "Acme Test" with mailboxes `b@x.test`, `a@x.test`: `deleteOrganization({ confirmName: " acme test " })` → `{ kind: "deleted", mailboxAddresses: ["a@x.test", "b@x.test"] }`; the organization row is gone.
2. `confirmName: "Acme"` → `name_mismatch`; every row stays.
3. Unknown id → `not_found`.
4. The log capture holds one `org_deleted` event with the org id, and no "Acme" and no `@x.test`.
5. `orgNameMatches` unit cases: `("Zażółć Sp.", "zażółć sp.")` true; `("Acme", "Acme Ltd")` false; `("Acme", "")` false.

## Step 2 — CLI `org:delete`

**Goal.** The operator deletes an organization from the shell.

**Files.** `apps/server/src/scripts/org-delete.ts`; `package.json` script `org:delete`.

**Interfaces.** `bun run org:delete --org-id <uuid> --confirm <name>`. Calls `deleteOrganization` with `via: "cli"`. Stdout on success: `deleted <org id>: mailboxes <n>` and then one line per mailbox address: `change the password of <address>` (the operator tells the owner). Exit 0. `not_found` → event `org_delete_refused` with `reason: "not_found"`, exit 1. `name_mismatch` → `reason: "name_mismatch"`, exit 1. A missing or bad argument → usage text, exit 2. The pattern of `org-flag.ts` (parse, config, service).

**Test** (integration, `org-cli.test.ts` or a new `org-delete-cli.test.ts`, run as a subprocess like the other CLI tests):

1. Right name → exit 0, stdout holds `deleted <id>`, the organization is gone.
2. Wrong name → exit 1, the organization stays.
3. No `--confirm` → exit 2.

**Check.** `bun test apps/server/test/integration/privacy-delete.test.ts` and the CLI test file; `bun run lint` (layers).

**Done when.** Tests pass, the module graph is fresh (`layers.test.ts`), and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** The web route, the flag (stage 03); docs (stage 09).
