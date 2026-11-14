# F104 stage 09 — Settings API and CLI

Part of [`../plan.md`](../plan.md). Needs stage 08 on `master`. Read D11, D12 first, and `config/routes.ts` (the `sync-folders` route), `config/view.ts`, `web.ts` `settingsRouteDeps` (the pattern).

After this stage `GET /api/settings/:mailboxId` returns the Sent state (or null with the flag off), an owner can change the switch with `PATCH /api/settings/:mailboxId/sent-sync`, and the operator can do both with `bun run mailbox:settings`.

## Step 1 — The view field and the route

**Goal.** `sentSync` in the settings view; one owner route that calls `setSentSync`.

**Files.** `packages/core/src/web/settings.ts`, `packages/core/src/web/settings.test.ts`, `apps/server/src/modules/mail/sent-view.ts` (new), `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/config/view.ts`, `apps/server/src/modules/config/routes.ts`, `apps/server/src/web.ts`, `apps/server/test/integration/web-settings.test.ts`.

**Interfaces.**

```ts
// packages/core/src/web/settings.ts
export const sentSyncErrorCodes = ["no_folder", "folder_missing", "failed"] as const;
export const sentSyncViewSchema = z.object({
  enabled: z.boolean(),
  folder: z.string().nullable(),            // mailboxes.folder_map.sent; null = no Sent folder known
  firstPassDone: z.boolean(),               // first_pass_at is set
  lastSentAt: z.iso.datetime().nullable(),  // SentSummary.newestUserAt
  storedCount: z.number().int().min(0),     // SentSummary.userCount, since now − 30 d
  errorCode: z.enum(sentSyncErrorCodes).nullable(),
});
export type SentSyncView = z.infer<typeof sentSyncViewSchema>;
// settingsViewSchema gains:  sentSync: sentSyncViewSchema.nullable(),   // null: the flag sent_sync is off
export const sentSyncBodySchema = z.object({ enabled: z.boolean() });

// apps/server/src/modules/mail/sent-view.ts
/** null when the flag sent_sync is off. A mailbox without a state row reads as off. */
export async function getSentSyncView(db: DbOrTrx, ctx: TenantContext, mailboxId: string, now: Date): Promise<SentSyncView | null>;

// config/view.ts SettingsViewDeps gains:
getSentSync(ctx: TenantContext, mailboxId: string): Promise<SettingsWebView["sentSync"]>;

// config/routes.ts SettingsRouteDeps gains:
setSentSync(ctx: TenantContext, mailboxId: string, input: { enabled: boolean; actor: string; now: Date }): Promise<"changed" | "same" | "not_found" | "flag_off">;
```

- `getSentSyncView`: `isFeatureOn(db, ctx, "sent_sync")` false → null; state (`getSentSyncState`), mailbox `folder_map.sent` (`getMailbox`), `getSentSummary(…, { since: now − 30 d })`; `enabled` = the state's or false; `firstPassDone = state?.firstPassAt != null`; `errorCode = state?.lastErrorCode ?? null`; `lastSentAt` as ISO string.
- `buildSettingsView` adds `sentSync: await deps.getSentSync(ctx, mailboxId)`.
- Route, next to `sync-folders`: `app.patch("/settings/:mailboxId/sent-sync", requireOwner, …)`: id check and `ensureSettings` as the other routes; `parseBody(c, sentSyncBodySchema)`; `result = await deps.setSentSync(ctx, id, { enabled, actor: session.userId, now: deps.now() })`; `not_found` and `flag_off` → `404 { error: "not_found" }` (a hidden feature looks absent); else `respond(c, id, { changed: result === "changed", expired: 0 })`.
- `web.ts` `settingsRouteDeps`: `getSentSync: (ctx, id) => getSentSyncView(db, ctx, id, now())`, `setSentSync: async (ctx, id, input) => (await setSentSync(db, ctx, id, { enabled: input.enabled, actor: input.actor, at: input.now })).result`.

**Decisions.** D12.

**Test.**

Unit (`settings.test.ts`): 1. a view with `sentSync: null` parses; 2. a full `sentSync` object parses; 3. `errorCode: "other"` fails; 4. `sentSyncBodySchema` refuses `{ enabled: "yes" }`.

Integration (`web-settings.test.ts`, its helpers for owner and member sessions):

5. Flag off → `GET /api/settings/:id` has `sentSync: null`; `PATCH …/sent-sync {enabled:true}` → 404.
6. Flag on, no state row → `sentSync` `{ enabled: false, folder: null, firstPassDone: false, lastSentAt: null, storedCount: 0, errorCode: null }` (the fixture mailbox has no `sent` key); with `folder_map.sent = "Sent"` → `folder "Sent"`.
7. Owner `PATCH {enabled:true}` → 200, `changed: true`, `settings.sentSync.enabled` true; again → `changed: false`.
8. With 2 user sent rows (`NOW − 1 d`, `NOW − 2 d`) and one system row → `storedCount 2`, `lastSentAt` = `NOW − 1 d` as ISO; owner `PATCH {enabled:false}` → `enabled` false, `storedCount 0`.
9. A member (not owner) → 403; no session → 401; a bad body → 400; another org's mailbox id and a non-uuid → 404.

**Check.** `bun test packages/core/src/web/settings.test.ts apps/server/test/integration/web-settings.test.ts`

**Done when.** Cases 1–9 pass; the existing settings cases pass (add `sentSync` where a case compares the whole view).

**Out of scope.** The panel (stage 10).

## Step 2 — CLI

**Goal.** `bun run mailbox:settings sent-sync --org-id … --mailbox-id … --value on|off`, and `show` prints the Sent state. The CLI calls the same service functions as the route.

**Files.** `apps/server/src/scripts/mailbox-settings-args.ts`, `apps/server/src/scripts/mailbox-settings.ts`, `apps/server/src/scripts/mailbox-settings-args.test.ts` (unit: parser and `describeSentSync`), `apps/server/test/integration/mail-sent-cli.test.ts` (new).

**Interfaces.**

- `usage` gains the line `  bun run mailbox:settings sent-sync --org-id <uuid> --mailbox-id <uuid> --value on|off`.
- `SettingsCommand` gains `{ kind: "sent-sync"; orgId: string; mailboxId: string; value: boolean }`; `allowed["sent-sync"] = ["value"]`.
- `run`, case `"sent-sync"`: `setSentSync(db, ctx, mailboxId, { enabled: command.value, actor: "cli", at: now })`; `flag_off` → `log.error("sent sync: the flag sent_sync is off for this organization (bun run org:flag)")`, exit 1; `not_found` → error line, exit 1; `same` → `log.info("no change")`; `changed` → `log.info(\`sent sync ${command.value ? "on" : "off"}\`)` plus, when off, `log.info(\`deleted ${deleted} sent mails\`)`. Keep the log form the script uses at your base (old form now; F103 may have converted the script to `createCliOutput`: follow it).
- `show`: after the folder lines, one line from `describeSentSync(view)` (a pure function in `mailbox-settings-args.ts`, next to `describeSyncFolder`): `sent: off (flag)` when the view is null; else `sent: on|off, folder <path>|none, stored <n>, last <ISO>|none, first pass done|pending, error <code>|none`. The folder path is printed here as the sync-folder lines print theirs (operator output, not a log event).

**Decisions.** D11, D12.

**Test** (the subprocess pattern of `mail-folders-cli.test.ts`: committed rows, cleanup in `finally`, audit rows ordered by `created_at` and `id`):

1. `sent-sync --value on` with the flag on → exit 0, stdout `sent sync on`; the state row is on; one audit row with actor `cli`.
2. `--value off` with 2 sent rows → exit 0, `deleted 2 sent mails`; no rows left.
3. Flag off → exit 1, stderr names the flag.
4. `show` → the `sent:` line (flag on, switch on, folder `Sent`, 0 stored).
5. Unit (`mailbox-settings-args.test.ts`): `parseSettingsArgs(["sent-sync", "--org-id", A, "--mailbox-id", M, "--value", "on"])` → the command; without `--value` → `undefined`; with `--key offers` → `undefined` (a flag of another subcommand).
6. Unit: `describeSentSync(null)` → `sent: off (flag)`; a full view → the exact line.

**Check.** `bun test apps/server/test/integration/mail-sent-cli.test.ts`

**Done when.** Cases 1–6 pass.

## Step 3 — Docs

`docs/capabilities/sent-mail.md`: Entry points rows `route` `GET /api/settings/:mailboxId` (`sentSync`), `PATCH /api/settings/:mailboxId/sent-sync` (owner) → `apps/server/src/modules/config/routes.ts`; `CLI` `bun run mailbox:settings` (`sent-sync`, `show`) → `apps/server/src/scripts/mailbox-settings.ts`; `function` `getSentSyncView` → `apps/server/src/modules/mail/sent-view.ts`; a rule: flag off hides the field and refuses the route with 404. `docs/capabilities/web-panel.md`: the settings API list gains the route (if the page lists the settings routes).

**Check.** `bun test apps/server/src/capability-map.test.ts`

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f104-s09`).
