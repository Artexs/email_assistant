# F122 stage 02b — Suggestion route

Part of [`../plan.md`](../plan.md). Needs stage 02: `createStyleSuggestion` and flag `style_from_sent`. C1 review after this stage (with 01 and 02).

The owner route over the service of stage 02, its API doc and the capability pages.

## Step 1 — Route, docs

- **Goal:** the route of `interfaces.md` in `replies/routes.ts`, with `apiDoc` and the core answer schema; the log events of D11 (fields from `platform/log-fields.ts`); capability pages: `reply-drafts.md` (new rule and limits), `sent-mail.md` rule 13 (sent text goes to the LLM for the open-loop analysis and, on the tap, for this suggestion; the switch is the consent; source: ADR 0029 decisions 6 and 7), `drafts-and-send.md` (style card line).
- **Decisions:** D8. Session first (401), then the flags (404 for every role, also a bad id), then `requireOwner`. The body is a strict empty object: any key → 400 `validation`.
- **Test (integration):**
  1. No session → 401; member → 403; no flag `style_from_sent` → 404; no flag `reply_drafts` → 404; body `{ "x": 1 }` → 400.
  2. Mailbox of org B → 404.
  3. The service answers map to 200, 409 and 429 as `interfaces.md` lists (one case each, `test.each`).
  4. A log line of a success holds `mailbox_id` and `count` only.
- **Check / Done when:** the touched tests pass; the guards (session, flags, owner, strict body) each fail their test when removed; the Proof line is PASS.
- **Out of scope:** the service (02); the web card (03); eval (06–09).
