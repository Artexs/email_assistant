# F098 stage 05 — Telegram consent in the link step [risky]

Part of [`../plan.md`](../plan.md). Decisions: P4, P6, D14. Needs stage 04 landed (both add keys to `en.ts`/`pl.ts` and `SAME_IN_BOTH`; `TelegramLink` sits on the Mailboxes and Onboarding pages). Review job before the land. One step (`[risky]`: a privacy gate).

After this stage nobody gets a Telegram link from the panel without the consent tick, and each accepted link request leaves an audit row with the consent version.

## Step 1 — Versioned consent, enforced by the link route, shown in the panel

**Goal.** The link step shows what goes to Telegram; the server refuses a link without the current consent; the consent is recorded per user (S6 master plan D27, P19, plan P4).

**Files.**

- Core: `packages/core/src/web/telegram.ts`.
- Server: `apps/server/src/modules/audit/repo.ts` (`auditEvents`), `apps/server/src/modules/channels/routes.ts`, `docs/architecture.md` (the `audit_log` row lists the web events: add `web.telegram_consent`).
- Web: `apps/web/src/components/telegram/TelegramLink.tsx`, `apps/web/src/lib/errors.ts`, `apps/web/src/i18n/{en,pl}.ts`.
- Tests: `apps/server/test/integration/web-telegram.test.ts` (every old `POST /api/channels/telegram/link` call that expects 200 or 502 gets the body `{ consentVersion: TELEGRAM_CONSENT_VERSION }` through `as(…, { method: "POST", body })`: at `3bdb753` the calls at lines 81, 105 and the 502 case at line 141; `grep -n '"POST"' apps/server/test/integration/web-telegram.test.ts` lists them. The 401, `bad_origin` and `telegram_off` cases keep no body. Nothing else changes in old cases), `apps/web/e2e/tests/onboarding.spec.ts` (tick the consent before the link click).

**Interfaces.**

```ts
// packages/core/src/web/telegram.ts
// The date of the consent text in the panel (i18n keys tg_consent_*). A change of that text gets a new date:
// the server then refuses links made with the old text.
export const TELEGRAM_CONSENT_VERSION = "2026-11-14";
export const telegramLinkBodySchema = z.object({ consentVersion: z.string().min(1).max(32) });
export type TelegramLinkBody = z.infer<typeof telegramLinkBodySchema>;

// apps/server/src/modules/audit/repo.ts, next to webTermsAccepted
webTelegramConsent: "web.telegram_consent", // data: via, version
```

`POST /channels/telegram/link`, in this order:

1. `deps.botUsername === null` → 409 `telegram_off` (as today, before the body).
2. `const body = await parseBody(c, telegramLinkBodySchema);` (no or bad JSON → 400, as every route).
3. `body.consentVersion !== TELEGRAM_CONSENT_VERSION` → 409 `{ error: "telegram_consent_outdated" }`.
4. `deps.botUsername()` → on error 502 `telegram_unreachable` (as today).
5. One transaction: `recordAudit(trx, ctx, { event: auditEvents.webTelegramConsent, actor: userId, data: { via: "web", version: TELEGRAM_CONSENT_VERSION }, at: deps.now() })`, then `createLinkToken(trx, ctx, userId, deps.now())` (it accepts a transaction: `linking.ts` `inTransaction`).
6. The answer as today (`Cache-Control: no-store`, `{ url, expiresAt }`). The log line stays `web: telegram link made for user <id>`; it never holds the version text or the body.

The CLI `telegram:link` (`apps/server/src/scripts/telegram-link.ts`) does not change (P4: an operator tool). `DELETE` does not change.

Web keys (en / pl; copy word for word):

| Key | en | pl |
| --- | --- | --- |
| `tg_consent_title` | What goes to Telegram | Co trafia do Telegrama |
| `tg_consent_text` | Telegram receives the messages of this bot: the sender and subject of your mails, the AI's short reason or summary, the texts of drafts that wait for your approval with the quoted part of the original mail, the names of delegates and the addresses of your mailboxes. Telegram's servers are outside the EU, and chats with a bot are not end-to-end encrypted. Telegram keeps the messages until you delete them in the chat. You can unlink Telegram at any time. | Telegram otrzymuje wiadomości tego bota: nadawcę i temat Twoich wiadomości, krótkie uzasadnienie lub podsumowanie AI, treść szkiców czekających na Twoje zatwierdzenie wraz z cytowaną częścią oryginalnej wiadomości, imiona wykonawców i adresy Twoich skrzynek. Serwery Telegrama są poza UE, a czaty z botem nie są szyfrowane end-to-end. Telegram przechowuje wiadomości, dopóki nie usuniesz ich z czatu. Możesz odłączyć Telegram w każdej chwili. |
| `tg_consent_label` | I agree that these data go to Telegram. | Zgadzam się na przekazywanie tych danych do Telegrama. |
| `tg_consent_outdated` | The consent text has changed. Reload the page and read it again. | Treść zgody się zmieniła. Odśwież stronę i przeczytaj ją ponownie. |

`errors.ts`: `telegram_consent_outdated: "tg_consent_outdated"`.

`TelegramLink.tsx`: in the state "not linked, available, bot reachable, no open link" (the branch that shows the `tg_link` button today), above the button: a heading (`tg_consent_title`, a small `h3` like the other card sections), the text (`tg_consent_text`), and a native checkbox with its `Label` (`tg_consent_label`; the markup of the terms checkbox in `islands/SetupPage.tsx:178-189`). State `agreed`, false on mount. The `tg_link` button and the `tg_new_link` button are `disabled` when `busy || !agreed`. `makeLink` sends `{ method: "POST", body: { consentVersion: TELEGRAM_CONSENT_VERSION } }`. The consent block does not show when the chat is linked or Telegram is off.

**Decisions.** P4, D14.

**Test.**

`web-telegram.test.ts`, new cases (the file's setup; `TELEGRAM_CONSENT_VERSION` from `@ea/core`):

1. Owner, `POST /api/channels/telegram/link` with no body → 400; no row in `chat_link_tokens` for the owner; no `web.telegram_consent` audit row in the organization.
2. Body `{}` → 400; body `{ consentVersion: "" }` → 400; same two "no row" checks.
3. Body `{ consentVersion: "2000-01-01" }` → 409, `error: "telegram_consent_outdated"`; same two "no row" checks.
4. Body with the current version → 200 with a `https://t.me/` URL; exactly one `chat_link_tokens` row for the owner; exactly one `web.telegram_consent` row with `actor` = the owner's id and `data` = `{ via: "web", version: TELEGRAM_CONSENT_VERSION }`.
5. A second accepted request → two consent rows; the first token is no longer valid (the existing "a new token makes the older unused tokens invalid" rule; assert it the way the file's earlier cases do, or with `consumeLinkToken` on the first token → `unknown`/`used`/`expired` as the code gives; name the result in the final message).
6. `setup(async () => { throw new Error("down"); })` (the file's 502 case at line 141 builds it this way or similar) with a valid body → 502; no token row; no consent row.
7. An app with `botUsername: null` and no body → 409 `telegram_off` (the order of the route).
8. An assistant (any member) with a valid body → 200 and the consent row has the assistant as actor.

`apps/server/test/integration/web-suspended.test.ts` must still pass unchanged (a suspended organization gets 403 before the body is read).

`onboarding.spec.ts`: before the click on `en.tg_link`, assert the button is disabled, check `page.getByLabel(en.tg_consent_label)`, then assert it is enabled and click as today.

**Check.** `bun test apps/server/test/integration/web-telegram.test.ts apps/server/test/integration/web-suspended.test.ts apps/server/test/integration/channels-linking.test.ts`; `bun test apps/web/src/i18n apps/web/src/lib`; `bun run typecheck`; `bun run lint`; the e2e run of the Proof.

**Done when.** Cases 1–8 pass; the onboarding spec passes in both projects with the consent tick; `i18n.test.ts` passes with the four new keys.

**Out of scope.** Consent for chats linked before this stage (P4: they keep their link). The CLI. The legal papers (they will cite the same list of data; E7-T4).

## Stage done when

- Step 1 is done.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 05) prints `PROOF_OK`.
