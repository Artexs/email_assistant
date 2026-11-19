# F104 stage 09 review notes (Sonnet review of d27b8fec: PASS)

Source: `.limen/jobs/2026-11-15-f104-review-s09-sonnet-sent-swit-33c46930/result`, logs in `/tmp/f104-s09-review/`. No blocking finding.

## Test gaps (closed in the follow-up commit)

- TG1: no `bad_origin` test for `PATCH …/sent-sync`. `web-settings.test.ts` now has one (no Origin and a foreign Origin; nothing changes). The origin check is one generic `/api/*` guard in `platform/http.ts`; removing it fails this test and the matrix test (`/tmp/f104-s09-fu/mut-origin.log`).
- TG2: "flag on, switch already on, PATCH on" had no named test. It now has one: 200, `changed: false`, no audit row, state kept.

## Notes

- N1: check order has no 400/404 leak: UUID and `ensureSettings` (org scoped) → body (400) → `setSentSync`. `flag_off` and `not_found` give the same 404 body. A foreign id with a bad body is 404.
- N2: owner only (member 403, no session 401); other org's owner gets 404 on GET and PATCH; `apiDoc` is complete; the route is in `WRITE_ROUTES` of `web-suspended.test.ts`. The body schema is not `strictObject`, like `syncFolderBodySchema`.
- N3: `setSentSync` is the only writer (web and CLI). Audit actor: the user id for the web, `cli` for the CLI.
- N4: the `sentSync` view holds no subject, address or text; the folder name is mailbox metadata and the canary test checks no console line holds it. GET is open to any member, like the other settings fields. Stage 10 shows the folder name in the panel.
- N5: CLI uses `createCliOutput`; `configureMailHosts` is called where `modules/mail` is imported; a foreign or unknown mailbox exits 1.
- N6: no migration, no `bun.lock` change, no ticket move.
- N7: docs are true. Fixed after the review: the CLI row of `actions-and-undo.md` now lists `sent-sync` and `urgency`.
- N8: PATCH off with the flag off and no state row inserts an off row and answers `same`. Harmless: the row reads as off.
- N9: the review did not check the `Decisions for the owner` section that `plan.md` asks for. This stage has no new owner decision: the CLI-on rule is Q13, the 404-when-hidden rule is D12.

## Carry-over

No note asks for a carry-over into stage 10 or 13. Stage 10 (panel) reads `sentSync` from the settings view and the route above (D12, D13); nothing changes in its file.
