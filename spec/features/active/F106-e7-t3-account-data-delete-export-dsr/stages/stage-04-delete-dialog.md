# F106 stage 04 — The delete dialog and the login notice

Part of [`../plan.md`](../plan.md). Web. New Polish text (review before the land).

## Step 1 — the dialog in the Account card

**Goal.** With the flag `org_delete` on, an owner can delete from the end of the Account card.

**Files.** A new `components/settings/DeleteOrganization.tsx` in `AccountCard.tsx`; `lib/delete-organization.ts` (runner, form reducer, login notice); `i18n/en.ts`, `pl.ts`; `lib/errors.ts` (`deleteError`).

**Decisions.** P1, P2, D5, P6.

- Shown only for role `owner` with `org_delete` in `/api/me` `features`; else nothing renders: `AccountCard.tsx` renders the whole block (with its border) only when `me !== null && canDeleteOrganization(me)`, so the UI does not change at all for a non-owner, with the flag off, or while `me` loads (SSR test `lib/account-card.test.tsx`).
- The button `del_title` opens a dialog (like the mailbox remove dialog) with `del_text`, `del_imap_note`, the password field (`autocomplete="current-password"`), the name field, Cancel and `del_submit`. `del_submit` is disabled until the typed name matches (`orgNameMatches` from `@ea/core/web`, stage 02).
- Before the request: write the marker `ea.deleting` (the time in ms) into `sessionStorage`; clear it when the request fails. On 200: write the `mailboxAddresses` into `ea.deleted_mailboxes` (JSON array), then `location.assign("/login?deleted=1")`.
- `wrong_password`, `wrong_name`, `locked` show their text. Any other server answer (`not_found`, a busy 503 `internal`) shows `del_failed`: nothing was deleted. An error with no server answer (network error, unreadable 200) shows `del_failed_unknown`: the delete may have run. Every outcome clears the password and the typed name. `deleteError` lives in `lib/errors.ts`.

## Step 2 — the notice on the login page

**Goal.** The person sees which mailbox passwords to change.

**Files.** `apps/web/src/islands/LoginPage.tsx`; the i18n files.

**Decisions.** D5. When `sessionStorage` `ea.deleted_mailboxes` holds a JSON array, also without `?deleted=1` (a 401 of the `/api/me` poll can land on `/login?next=…` first): `del_done_title`, `del_done_text`, the addresses as plain text; then the key goes. A fresh `ea.deleting` marker (at most 2 minutes old) alone shows the same texts without a list; the marker goes on every read. `?deleted=1` with no key or bad JSON: the texts, no list. Language: the stored browser choice.

**Texts.** Copy word for word. `{name}` is the organization name.

| Key | en | pl |
| --- | --- | --- |
| `del_title` | Delete organization | Usuń organizację |
| `del_text` | This deletes the organization {name} and all its data here at once: mailboxes, mail, triage results, actions, delegations, rules, Telegram links, history and the accounts of its members. It cannot be undone. Backups keep a copy until they expire; the privacy policy gives the period. | To od razu usunie organizację {name} i wszystkie jej dane w aplikacji: skrzynki, wiadomości, wyniki klasyfikacji, działania, zlecenia, reguły, połączenia z Telegramem, historię i konta jej członków. Tego nie można cofnąć. Kopie zapasowe zachowują dane, dopóki nie wygasną; okres określa polityka prywatności. |
| `del_imap_note` | Drafts and folders that the assistant made in your mailboxes stay there. Delete them in your mail program if you do not want them. After the delete, change your mailbox passwords in your mail provider's settings: the assistant knew them, and they still work. | Szkice i foldery, które asystent utworzył w Twoich skrzynkach, zostaną w nich. Usuń je w programie pocztowym, jeśli ich nie chcesz. Po usunięciu zmień hasła do skrzynek u dostawcy poczty: asystent je znał, a one nadal działają. |
| `del_password_label` | Your password | Twoje hasło |
| `del_confirm_label` | Type the organization name to confirm | Wpisz nazwę organizacji, aby potwierdzić |
| `del_submit` | Delete everything | Usuń wszystko |
| `del_deleting` | Deleting… | Usuwanie… |
| `del_wrong_password` | Wrong password. | Błędne hasło. |
| `del_wrong_name` | The name does not match. | Nazwa się nie zgadza. |
| `del_locked` | Too many wrong passwords. Try again in 15 minutes. | Za dużo błędnych prób. Spróbuj ponownie za 15 minut. |
| `del_failed` | The delete failed. Nothing was deleted. Try again. | Usuwanie nie powiodło się. Nic nie zostało usunięte. Spróbuj ponownie. |
| `del_failed_unknown` | We could not confirm the deletion. Reload the page and check whether you can still sign in. | Nie udało się potwierdzić usunięcia. Odśwież stronę i sprawdź, czy nadal możesz się zalogować. |
| `del_done_title` | Organization deleted | Organizacja usunięta |
| `del_done_text` | All data is deleted and the session is ended. Change the passwords of your mailboxes in your mail provider's settings now: the assistant knew them. | Wszystkie dane zostały usunięte, a sesja zakończona. Zmień teraz hasła swoich skrzynek w ustawieniach dostawcy poczty: asystent je znał. |
| `del_done_mailboxes` | Mailboxes of the deleted organization: | Skrzynki usuniętej organizacji: |

Cancel uses the existing `cancel` key. `SAME_IN_BOTH` in `i18n.test.ts` does not change.

**Test** (web unit tests; where the web tests no islands, test pure helpers):

1. Not owner, or flag off → no delete button (`del_title`).
2. Submit stays disabled for `"Acme"` against "Acme Test" and turns on for `" acme test "`.
3. A 400 `wrong_password` answer shows `del_wrong_password` and clears the password field.
4. A 200 answer stops the `/api/me` poll if the shell allows it, writes `["a@x.test","b@x.test"]` to `ea.deleted_mailboxes` and goes to `/login?deleted=1`.
5. The login notice lists both addresses on `/login?next=/settings` too, and removes the key; `?deleted=1` with no key, or the key `"{bad"`, shows the texts without a list.
6. `i18n.test.ts` passes.
7. The Account card renders no delete block (and no empty bordered block) for a non-owner, with the flag off, or while `me` loads; with the flag on it renders one block more (SSR, `lib/account-card.test.tsx`).
8. The `ea.deleting` marker is written before the request and cleared on failure; a fresh marker alone shows the login notice without a list; a stale marker shows nothing.
9. A network error or an unreadable 200 shows `del_failed_unknown`; `not_found` and `internal` show `del_failed`.

**Done when.** Tests 1–9 pass and the plan Proof (web chain) prints `PROOF_OK`.

**Out of scope.** Playwright (stage 11); security-log texts (stage 10).
