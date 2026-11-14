# F104 stage 09 — Settings API and CLI

Part of [`../plan.md`](../plan.md). Needs stage 08. Read D11, D12, and the `sync-folders` route as the pattern (`config/routes.ts`, `config/view.ts`, `web.ts` `settingsRouteDeps`).

After this stage the settings API shows and changes the Sent switch (owner), and so does `bun run mailbox:settings`.

## Step 1 — View field and route

**Interfaces.**

```ts
// packages/core/src/web/settings.ts
export const sentSyncErrorCodes = ["no_folder", "folder_missing", "failed"] as const;
export const sentSyncViewSchema = z.object({
  flagOn: z.boolean(),                     // false = paused: the switch can only go off
  enabled: z.boolean(),
  folder: z.string().nullable(),           // folder_map.sent; null = no Sent folder known
  firstPassDone: z.boolean(),
  lastSentAt: z.iso.datetime().nullable(), // SentSummary.newestUserAt
  storedCount: z.number().int().min(0),    // SentSummary.userCount since now − 30 d
  errorCode: z.enum(sentSyncErrorCodes).nullable(),
});
export type SentSyncView = z.infer<typeof sentSyncViewSchema>;
// settingsViewSchema gains  sentSync: sentSyncViewSchema.nullable()
export const sentSyncBodySchema = z.object({ enabled: z.boolean() });

// mail/sent-view.ts (new)
getSentSyncView(db, ctx, mailboxId, now): Promise<SentSyncView | null>

// config: SettingsViewDeps gains
getSentSync(ctx, mailboxId): Promise<SentSyncView | null>;
// SettingsRouteDeps gains
setSentSync(ctx, mailboxId, { enabled, actor, now }): Promise<"changed" | "same" | "not_found" | "flag_off">;
```

- `getSentSyncView`: flag off and switch off (or no state row) → null; else the fields above (no state row reads as off).
- `buildSettingsView` adds `sentSync` from `deps.getSentSync`.
- Route `PATCH /settings/:mailboxId/sent-sync`, owner only, in the form of the folder route: `not_found` and `flag_off` → 404 `{ error: "not_found" }` (a hidden feature looks absent); else the settings answer with `changed`.
- `web.ts` wires both deps to the `mail` functions (`config` may not import `mail`, F6).

**Test.**

Unit (`settings.test.ts`): 1. `sentSync: null` parses; 2. a full object parses; 3. `errorCode "other"` fails; 4. the body schema refuses `{ enabled: "yes" }`.

Integration (`web-settings.test.ts`):

5. Flag off, no state → `sentSync: null`; PATCH on → 404. Flag off, switch on, 1 sent row → `flagOn false`, `enabled true`; PATCH off → 200, the row is gone, then `null`.
6. Flag on, no state → `{ flagOn: true, enabled: false, folder: null, firstPassDone: false, lastSentAt: null, storedCount: 0, errorCode: null }`; with `folder_map.sent "Sent"` → `folder "Sent"`.
7. Owner PATCH on → 200, `changed: true`, `enabled true`; again → `changed: false`.
8. 2 user rows (`NOW − 1 d`, `− 2 d`) and a system row → `storedCount 2`, `lastSentAt` `NOW − 1 d`; PATCH off → `enabled false`, `storedCount 0`.
9. Member → 403; no session → 401; bad body → 400; another org's id or a non-uuid → 404.

Existing settings cases pass (add `sentSync` where a case compares the whole view).

## Step 2 — CLI

**Interfaces.**
- `bun run mailbox:settings sent-sync --org-id <uuid> --mailbox-id <uuid> --value on|off`: a new `SettingsCommand` kind with its own `case` before the default branch of `parseSettingsArgs`; a usage line.
- It calls `setSentSync` (actor `cli`). `flag_off` → an error line that names the flag and `bun run org:flag`, exit 1; `not_found` → exit 1; `same` → `no change`; `changed` → `sent sync on|off`, and when off `deleted <n> sent mails`. Keep the script's output form at your base.
- `show` calls `getSentSyncView` itself and prints one line from a pure `describeSentSync(view)` next to `describeSyncFolder`: `sent: off (flag)` for null; else `sent: on|off, folder <path>|none, stored <n>, last <ISO>|none, first pass done|pending, error <code>|none`, plus `, paused (flag off)`.
- `mailbox-connect.ts`: the stage 08 line gains `(turn off: bun run mailbox:settings sent-sync --org-id <org> --mailbox-id <id> --value off)`.

**Test** (the subprocess form of `mail-folders-cli.test.ts`):

1. On with the flag on → exit 0, `sent sync on`, state on, one audit row with actor `cli`.
2. Off with 2 rows → exit 0, `deleted 2 sent mails`, no rows.
3. Flag off: on → exit 1, stderr names the flag; off on an enabled row → exit 0.
4. `show` → the `sent:` line.
5. Unit: the parser gives the command; without `--value`, or with `--key`, → `undefined`.
6. Unit: `describeSentSync(null)` and a full view give the exact lines.

## Step 3 — Docs

`docs/capabilities/sent-mail.md`: entry points (both routes, the CLI, `getSentSyncView`) and the rule "flag off hides the field; the route answers 404". `docs/capabilities/web-panel.md`: the route, if the page lists settings routes.

## Done when

Steps 1–3 done; the Proof passes (`/tmp/f104-s09`).
