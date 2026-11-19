# F104 stage 10 — Panel: card and connect line

Part of [`../plan.md`](../plan.md). Needs stage 09. Read D13, D17, and `apps/web/src/components/settings/SyncFoldersCard.tsx` (the card model) and `apps/web/src/components/mailboxes/ConnectDialog.tsx`.

## Step 1 — Status helper and texts

**Files.** `apps/web/src/lib/sent-text.ts`, `apps/web/src/lib/sent-text.test.ts` (new, unit lane); `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/pl.ts`.

**Interface.**

```ts
/** The one status line under the switch; null when the switch is off. */
sentStatusLine(view: SentSyncView): { key: TextKey; vars?: Record<string, string> } | null
```

Rules for `enabled` true, first match wins: `flagOn` false → `sent_paused`; no folder or `no_folder` → `sent_no_folder`; `folder_missing` → `sent_folder_missing`; `failed` → `sent_failed`; no first pass → `sent_first_pass`; no `lastSentAt` or `storedCount 0` → `sent_none`; else `sent_last` with `vars.at = lastSentAt`. The card renders it as `t("sent_last", { time: formatClock(new Date(vars.at), timeZone, now, getLocale()) })`, as `apps/web/src/components/mailboxes/MailboxCard.tsx` renders `mb_last_sync`; other keys as `t(key)`.

Texts (both files; Polish per D17):

| Key | en | pl |
| --- | --- | --- |
| `sent_title` | Sent mail | Wysłane |
| `sent_switch` | Track my sent mail | Śledź moją wysłaną pocztę |
| `sent_line` | The assistant reads Sent to see what you wait for. It does not change or delete your mail there. | Asystent czyta folder Wysłane, żeby wiedzieć, na co czekasz. Nie zmienia ani nie usuwa tam Twoich wiadomości. |
| `sent_off_note` | Turning it off deletes the sent mail that the assistant stored. | Wyłączenie usuwa wysłaną pocztę zapisaną przez asystenta. |
| `sent_no_folder` | No Sent folder found in this mailbox. | W tej skrzynce nie ma folderu Wysłane. |
| `sent_folder_missing` | The Sent folder is not on the server any more. | Folderu Wysłane nie ma już na serwerze. |
| `sent_failed` | The last read of Sent failed. The next sync tries again. | Ostatni odczyt folderu Wysłane nie powiódł się. Następna synchronizacja spróbuje ponownie. |
| `sent_first_pass` | The first read of Sent runs at the next sync. | Pierwszy odczyt folderu Wysłane nastąpi przy najbliższej synchronizacji. |
| `sent_none` | No sent mail in the last 30 days. Does your mail app keep a copy in Sent? | Brak wysłanej poczty z ostatnich 30 dni. Czy Twój program pocztowy zapisuje kopię w folderze Wysłane? |
| `sent_last` | Last sent mail seen: {time}. | Ostatnia wysłana wiadomość: {time}. |
| `sent_paused` | Sent mail tracking is paused for your organization. You can turn it off; that deletes the stored sent mail. | Śledzenie wysłanej poczty jest wstrzymane dla Twojej organizacji. Możesz je wyłączyć; to usunie zapisaną wysłaną pocztę. |
| `sent_on_toast` | Sent mail is tracked. | Wysłana poczta jest śledzona. |
| `sent_off_toast` | Sent mail is not tracked. The stored sent mail is deleted. | Wysłana poczta nie jest śledzona. Zapisana wysłana poczta została usunięta. |

**Test** (`view()` = on, folder `Sent`, first pass done, `lastSentAt "2026-11-19T10:00:00.000Z"`, `storedCount 3`, no error, flag on):

1. Off → null. 2. Flag off → `sent_paused` (before every other rule).
3. No folder, or `no_folder` → `sent_no_folder`. 4. `folder_missing`, `failed` → their keys.
5. No first pass → `sent_first_pass`. 6. `storedCount 0` or no `lastSentAt` → `sent_none`.
7. The default → `sent_last` with `at`. 8. `en.sent_line` and `pl.sent_line` are not empty; the i18n suites pass.

## Step 2 — Card and connect line

- `apps/web/src/components/settings/SentMailCard.tsx` (new), props as `SyncFoldersCard` plus `timeZone`: `data-card="sent"`, title, one `Switch` (label `sent_switch`; disabled for a member, while pending, and when paused and off) that calls `patchSettings(id, "/sent-sync", { enabled })`, then a toast key; under it `sent_line`, the folder path, the status line (muted), `sent_off_note` (muted). Errors as the folder card; a 404 calls `onMissing`. Only existing `ui/` components.
- `apps/web/src/islands/SettingsPage.tsx`: the card after `SyncFoldersCard` when `sentSync !== null`.
- `apps/web/src/components/mailboxes/ConnectDialog.tsx`: a prop `sentSyncLine`; true → one muted `sent_line` paragraph above the footer. `apps/web/src/islands/MailboxesPage.tsx` passes `me.features.includes("sent_sync")`.

**Check.** `bun run lint && bun run typecheck`; the card has no literal text.

**Out of scope.** An e2e case (a later spec takes a free `nextAddress` block of `apps/web/e2e/env.ts`).

## Step 3 — Docs

`docs/capabilities/web-panel.md`: the card (flag `sent_sync`) and the connect line. `docs/capabilities/sent-mail.md`: entry point of the card; drop "no switch in the panel" from Limits.

## Done when

Steps 1–3 done; the Proof passes (`/tmp/f104-s10`).

## Carry-over from the stage 08 review (F104)

Do not turn the flag `sent_sync` on for any non-lab org before this stage lands (see review-8.md N5). Until stage 09 an owner cannot turn the switch off.
