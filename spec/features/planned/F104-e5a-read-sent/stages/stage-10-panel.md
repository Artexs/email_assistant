# F104 stage 10 — Panel: card and connect line

Part of [`../plan.md`](../plan.md). Needs stage 09 on `master`. Read D13 and D17 first, and `apps/web/src/components/settings/SyncFoldersCard.tsx` (the model for the card) and `apps/web/src/components/mailboxes/ConnectDialog.tsx`.

After this stage the owner sees a "Sent mail" card on the mailbox settings page (switch, plain line, status line) when the flag is on, and the connect dialog shows the plain line. Members see the card read-only.

## Step 1 — Status helper and texts

**Goal.** One pure function picks the status line; every text exists in `en` and `pl`.

**Files.** `apps/web/src/lib/sent-text.ts` (new), `apps/web/src/lib/sent-text.test.ts` (new), `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/pl.ts`.

**Interfaces.**

```ts
import type { SentSyncView } from "@ea/core/web";
import type { TextKey } from "../i18n";

/** The one status line under the switch; null when the switch is off. */
export function sentStatusLine(view: SentSyncView): { key: TextKey; vars?: Record<string, string> } | null;
```

Order of the rules (first match wins), for `enabled` true: `flagOn` false → `sent_paused`; `folder === null` or `errorCode === "no_folder"` → `sent_no_folder`; `errorCode === "folder_missing"` → `sent_folder_missing`; `errorCode === "failed"` → `sent_failed`; `!firstPassDone` → `sent_first_pass`; `lastSentAt === null` or `storedCount === 0` → `sent_none`; else `{ key: "sent_last", vars: { at: view.lastSentAt } }`. The card renders that one as `t("sent_last", { time: formatClock(new Date(at), timeZone, now, getLocale()) })`, as `MailboxCard.tsx` line 58 renders `mb_last_sync`; every other key renders as `t(key)`.

Texts (keys in both files; the Polish follows the F098 glossary, P6 of its plan):

| Key | en | pl |
| --- | --- | --- |
| `sent_title` | Sent mail | Wysłane |
| `sent_switch` | Track my sent mail | Śledź moją wysłaną pocztę |
| `sent_line` | The assistant reads Sent, never changes it, to see what you wait for. | Asystent czyta folder Wysłane i nigdy go nie zmienia, żeby wiedzieć, na co czekasz. |
| `sent_off_note` | Turning it off deletes the sent mail that the assistant stored. | Wyłączenie usuwa wysłaną pocztę zapisaną przez asystenta. |
| `sent_no_folder` | No Sent folder found in this mailbox. | W tej skrzynce nie ma folderu Wysłane. |
| `sent_folder_missing` | The Sent folder is not on the server any more. | Folderu Wysłane nie ma już na serwerze. |
| `sent_failed` | The last read of Sent failed. The next sync tries again. | Ostatni odczyt folderu Wysłane się nie udał. Następna synchronizacja spróbuje ponownie. |
| `sent_first_pass` | The first read of Sent runs at the next sync. | Pierwszy odczyt folderu Wysłane nastąpi przy najbliższej synchronizacji. |
| `sent_none` | No sent mail in the last 30 days. Does your mail app keep a copy in Sent? | Brak wysłanej poczty z ostatnich 30 dni. Czy Twój program pocztowy zapisuje kopię w folderze Wysłane? |
| `sent_last` | Last sent mail seen: {time}. | Ostatnia wysłana wiadomość: {time}. |
| `sent_paused` | Sent mail tracking is paused for your organization. You can turn it off; that deletes the stored sent mail. | Śledzenie wysłanej poczty jest wstrzymane dla Twojej organizacji. Możesz je wyłączyć; to usuwa zapisaną wysłaną pocztę. |
| `sent_on_toast` | Sent mail is tracked. | Wysłana poczta jest śledzona. |
| `sent_off_toast` | Sent mail is not tracked. The stored sent mail is deleted. | Wysłana poczta nie jest śledzona. Zapisana wysłana poczta została usunięta. |

**Decisions.** D13, D17.

**Test** (unit, `sent-text.test.ts`; a `view(overrides)` helper with `enabled true, folder "Sent", firstPassDone true, lastSentAt "2026-11-19T10:00:00.000Z", storedCount 3, errorCode null`):

1. `enabled false` → null.
1b. `flagOn false`, `enabled true` → `sent_paused` (before every other rule).
2. `folder null` → `sent_no_folder`; `errorCode "no_folder"` → `sent_no_folder`.
3. `errorCode "folder_missing"` → `sent_folder_missing`; `"failed"` → `sent_failed`.
4. `firstPassDone false` → `sent_first_pass`.
5. `storedCount 0` → `sent_none`; `lastSentAt null` → `sent_none`.
6. The default view → `{ key: "sent_last", vars: { at: "2026-11-19T10:00:00.000Z" } }`.
7. Every key of the table exists in `en` and `pl` (typecheck forces it; one test reads `en.sent_line` and `pl.sent_line` and expects both non-empty).

**Check.** `bun test apps/web/src/lib/sent-text.test.ts && bun run typecheck`

**Done when.** Cases 1–7 and 1b pass.

## Step 2 — The card and the connect line

**Goal.** The card on the settings page; the line in the connect dialog.

**Files.** `apps/web/src/components/settings/SentMailCard.tsx` (new), `apps/web/src/islands/SettingsPage.tsx`, `apps/web/src/components/mailboxes/ConnectDialog.tsx`, `apps/web/src/islands/MailboxesPage.tsx`.

**Interfaces.**

- `SentMailCard({ settings, isOwner, timeZone, onChanged, onMissing })`, the shape of `SyncFoldersCard`: `Card` with `data-card="sent"`, title `sent_title`; one row: label `sent_switch` and a `Switch` (`aria-label` = `t("sent_switch")`, `checked = settings.sentSync.enabled`, disabled when `!isOwner`, when pending, or when `!settings.sentSync.flagOn && !settings.sentSync.enabled` (paused: only off is allowed)) that calls `patchSettings(settings.mailboxId, "/sent-sync", { enabled })` and then `onChanged(result, enabled ? "sent_on_toast" : "sent_off_toast")`; under it `t("sent_line")`, the folder path when not null (as the folder rows show `folder.path`), the status line of `sentStatusLine` (muted text), and `t("sent_off_note")` (muted). Errors: `toast.error(t(errorText(error)))`; a 404 calls `onMissing`. Use only the existing `ui/` components.
- `SettingsPage.tsx`: render `<SentMailCard …/>` after `SyncFoldersCard` only when `data.sentSync !== null`; `timeZone` from `me.organization.timezone` (the page reads `me` already; pass it into `MailboxSettings` if that component does not get it yet).
- `ConnectDialog.tsx`: a new prop `sentSyncLine: boolean`; when true, one muted paragraph `t("sent_line")` above the dialog footer. `MailboxesPage.tsx` passes `sentSyncLine={me.features.includes("sent_sync")}` (the `AccountCard.tsx` line 282 form).

**Decisions.** D13.

**Test.** Typecheck and lint cover the components (the panel has no component tests). Manual check is not required.

**Check.** `bun run lint && bun run typecheck`

**Done when.** Both pass; `grep -n "sent_" apps/web/src/components/settings/SentMailCard.tsx` shows only `t(…)` keys, no literal text.

**Out of scope.** An e2e case (the e2e seed has no feature flags; a later e2e ticket may add one).

## Step 3 — Docs

`docs/capabilities/web-panel.md`: the settings page gains the "Sent mail" card (flag `sent_sync`) and the connect dialog line. `docs/capabilities/sent-mail.md`: Entry points row `page` `/settings` (card "Sent mail") → `apps/web/src/components/settings/SentMailCard.tsx`; remove "no switch in the panel yet" from Limits.

**Check.** `bun test apps/server/src/capability-map.test.ts`

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f104-s10`).
