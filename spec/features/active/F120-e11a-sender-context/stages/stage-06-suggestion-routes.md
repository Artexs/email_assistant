# F120 stage 06 — Suggestion routes and weekly line

Part of [`../plan.md`](../plan.md). Decisions P3, P4. Names: interfaces.md § Contacts module, § Core (`SuggestionItem`).

Carry-over reads: `apps/server/src/modules/config/routes.ts` (`rulesRoutes`: owner check, mailbox 404), `modules/triage/review-routes.ts` (flag-first middleware), `docs/code-patterns.md` § HTTP routes, `packages/core/src/digest/weekly.ts` (`renderWeeklyReport`), `modules/channels/notices/weekly-report.ts`, `docs/capabilities/digest-and-notices.md` (weekly report rule).

## Step 1 — routes

- `suggestionRoutes` in `contacts`, mounted in `apps/server/src/web.ts`. The flag check is the first middleware: `senderFlags().suggestions` false (P1: `sender_suggestions` off, or `sender_context` off) → 404 `not_found` for every role, also with a bad id or body.
- `GET /api/suggestions/:mailboxId` (any member): open rows of the mailbox, newest first, as `SuggestionItem[]` (schema in `@ea/core/web`). Mailbox of another org or unknown → 404.
- `POST /api/suggestions/:id/accept` and `/dismiss` (owner; 403 `owner_only` before any query): body `{}`; answers 200 `{ status: "accepted" | "dismissed" }`; `already` → 409 `already`; `rule_limit` → 409 `rule_limit`; `not_found` → 404. A suspended org → 403 `org_suspended` (the write guard). `via: "web"`.
- OpenAPI entries as the other routes (`openapi-routes.test.ts`).
- Test (`web-suggestions.test.ts`):
  1. 401 without a session on all three.
  2. `sender_suggestions` off → 404 for owner and member; `sender_suggestions` on with `sender_context` off → 404.
  3. Member GET → 200 with items; member POST accept → 403.
  4. Owner accept → 200, rule exists; again → 409 `already`.
  5. Other org's mailbox id and suggestion id → 404.
  6. Bad uuid → 404 (as the review routes).

## Step 2 — weekly report line

- When `senderFlags().suggestions` is true and the mailbox (or the org, summed over mailboxes) has open suggestions, the weekly report view gets the optional key `suggestions: { open: number }` and the text gets one line: en `💡 <n> rule suggestion(s) wait for you · <WEB_BASE_URL>/rules`, pl `💡 Sugestie reguł do przejrzenia: <n> · <WEB_BASE_URL>/rules`; with no `WEB_BASE_URL`: `… · check them in the panel` / `… · sprawdź w panelu`. No line at 0.
- The view schema accepts rows without the key (rows queued in the last 24 h; rollback note).
- Counts and fixed words only: no consent version change.
- Test:
  1. Core: `renderWeeklyReport` with `suggestions.open = 2` → the en and pl lines; with 0 or no key → no line; plural form for 1 and 5 in Polish uses the existing plural helper.
  2. Integration: detector with the flag on and 2 open rows → the queued view holds `suggestions.open = 2`; flag off → no key.
  3. A pending row with the old view shape still renders.

## Done when

All tests pass; mutation: move the flag middleware after the role check → test 2 fails for the member case. Then the Proof command.
