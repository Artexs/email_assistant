# F106 stage 04 — The delete dialog and the login notice

Part of [`../plan.md`](../plan.md). Web. New Polish text (review before the land).

## Step 1 — the dialog in the Account card

**Goal.** An owner sees the delete button at the end of the Account card while the flag `org_delete` is on, and can delete.

**Files.** `apps/web/src/components/settings/` (a new `DeleteOrganization.tsx`, used by `AccountCard.tsx`); `apps/web/src/i18n/en.ts`, `pl.ts`; the error map of `lib/errors.ts`.

**Decisions.** P1, P2, D5, P6.

- Shown only for role `owner` with `org_delete` in `/api/me` `features`; else nothing renders.
- The button `del_title` opens a dialog (like the mailbox remove dialog) with `del_text`, `del_imap_note`, the password field (`autocomplete="current-password"`), the name field, Cancel and `del_submit`. `del_submit` is disabled until the typed name matches (`orgNameMatches` from `@ea/core/web`, stage 02).
- On 200: write the `mailboxAddresses` into `sessionStorage` key `ea.deleted_mailboxes` (JSON array), then `location.assign("/login?deleted=1")`.
- `wrong_password`, `wrong_name`, `locked` show their text; any other error `del_failed`. Each error clears the password field.

## Step 2 — the notice on the login page

**Goal.** After the delete, the person sees which mailbox passwords to change.

**Files.** `apps/web/src/islands/LoginPage.tsx`; the i18n files.

**Decisions.** D5. With `?deleted=1`: `del_done_title`, `del_done_text`, and below it the addresses from `sessionStorage` `ea.deleted_mailboxes` (plain text); then the key is removed. No key or bad JSON (a reload): no list. Language: the stored browser choice.

**Texts.** Copy word for word. `{name}` is the organization name.

| Key | en | pl |
| --- | --- | --- |
| `del_title` | Delete organization | Usuń organizację |
| `del_text` | This deletes the organization {name} and all its data here at once: mailboxes, mail, triage results, actions, delegations, rules, Telegram links, history and the accounts of its members. It cannot be undone. Backups keep a copy until they expire; the privacy policy gives the period. | To od razu usunie organizację {name} i wszystkie jej dane w aplikacji: skrzynki, wiadomości, wyniki klasyfikacji, działania, zlecenia, reguły, połączenia z Telegramem, historię i konta jej członków. Tego nie można cofnąć. Kopie zapasowe przechowują dane do czasu ich wygaśnięcia; okres podaje polityka prywatności. |
| `del_imap_note` | Drafts and folders that the assistant made in your mailboxes stay there. Delete them in your mail program if you do not want them. | Szkice i foldery, które asystent utworzył w Twoich skrzynkach, zostaną w nich. Usuń je w programie pocztowym, jeśli ich nie chcesz. |
| `del_password_label` | Your password | Twoje hasło |
| `del_confirm_label` | Type the organization name to confirm | Wpisz nazwę organizacji, aby potwierdzić |
| `del_submit` | Delete everything | Usuń wszystko |
| `del_wrong_password` | Wrong password. | Nieprawidłowe hasło. |
| `del_wrong_name` | The name does not match. | Nazwa się nie zgadza. |
| `del_locked` | Too many wrong passwords. Try again in 15 minutes. | Zbyt wiele błędnych haseł. Spróbuj ponownie za 15 minut. |
| `del_failed` | The delete failed. Nothing was deleted. Try again. | Usuwanie nie powiodło się. Nic nie zostało usunięte. Spróbuj ponownie. |
| `del_done_title` | Organization deleted | Organizacja usunięta |
| `del_done_text` | All data is deleted and the session is ended. Change the passwords of your mailboxes in your mail provider's settings now: the assistant knew them. | Wszystkie dane zostały usunięte, a sesja zakończona. Zmień teraz hasła swoich skrzynek w ustawieniach dostawcy poczty: asystent je znał. |

Cancel uses the existing `cancel` key. `SAME_IN_BOTH` in `i18n.test.ts` does not change.

**Test** (web unit tests as the existing ones; where the web tests no islands, test the pure helpers):

1. Not owner, or flag off → no delete button (`del_title`).
2. Submit stays disabled for `"Acme"` against "Acme Test" and turns on for `" acme test "`.
3. A 400 `wrong_password` answer shows `del_wrong_password` and clears the password field.
4. A 200 answer writes `["a@x.test","b@x.test"]` to `ea.deleted_mailboxes` and goes to `/login?deleted=1`.
5. The login notice lists both addresses and removes the key; no key, or the key `"{bad"`, shows the texts without a list.
6. `i18n.test.ts` passes.

**Done when.** Tests 1–6 pass and the plan Proof (web chain) prints `PROOF_OK`.

**Out of scope.** Playwright (stage 10); security-log texts (stage 09).
