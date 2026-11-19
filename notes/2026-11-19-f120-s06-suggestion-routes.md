# F120 stage 06: suggestion routes and the weekly line, what later stages must know

Written by the stage 06 worker (2026-11-19). Code: `apps/server/src/modules/contacts/routes.ts` (`suggestionRoutes`),
`api-docs.ts`, `suggestion-commands.ts` (`countOpenSuggestionsOfOrg`), `packages/core/src/web/sender-context.ts` (schemas),
`apps/server/src/modules/channels/notices/weekly-report.ts` (`suggestionsOf`), `packages/core/src/digest/weekly.ts`.

## Routes

- `GET /api/suggestions/:mailboxId` (member): 200 `SuggestionItem[]`, **newest first** (the reader `listOpenSuggestions` changed from
  oldest first to newest first; its test follows). A mailbox of another organization, an unknown id and a bad id: 404 `not_found`
  (`getMailbox` is the check). A paused, `auth_error` or `host_blocked` mailbox: 200 `[]` (the reader returns nothing for it).
- `POST /api/suggestions/:id/accept` and `/dismiss` (owner): body `{}` (strict; any key: 400 `validation`); 200 `{ status }`;
  `already` and `rule_limit` 409 (`{ error }`), `not_found` 404.
- Middleware order: session, Origin, suspended-org guard (the app), then `flagFirst`, then `requireOwner`, then the apiDoc, then the
  handler. With `sender_suggestions` off or `sender_context` off every route is 404 for every role, also with a bad id or body.
  Order inside the handler: id check (404), body (400), command.
- Accept goes through `acceptSuggestion` → `addSenderRule` (the writer of the Rules page): a double accept, also 4 at once, makes
  one rule and one `suggestion.accepted` row (the row lock of stage 05).
- No address in any answer except the list body, no log line (the routes log nothing), no audit field (`mailbox_id`, `kind`,
  `scope`, `via: "web"`).
- Schemas for stage 07: `suggestionListSchema`, `suggestionActionBodySchema`, `suggestionResultSchema` in `@ea/core/web`.
- OpenAPI: `suggestionDocs` (tags `suggestions`); `web-suspended.test.ts` lists the two POST routes.

## Weekly line

- View key `suggestions?: { open: number; panelUrl?: string }` (optional, strict; `panelUrl` is a `panelUrlSchema` link). The stage
  text said `{ open }` only; the link had to go into the view because the renderer has no base URL (the approval card does the
  same with `panelUrl`). `suggestionsOf` leaves the key out when the count is 0, the flag is off, or no mailbox is active.
- Count: `countOpenSuggestionsOfOrg` (open rows of the active mailboxes of the organization, one query, count only).
- Texts (`texts/notices.ts`, `weekly.suggestions.line`): en `💡 <n> rule suggestion(s) wait(s) for you · <link>`; without link
  `check it in the panel` (1) or `check them in the panel` (more); pl `💡 Sugestie reguł do przejrzenia: <n> · <link>` /
  `sprawdź w panelu`. The Polish line has the count after a colon, so no noun takes a plural form (the stage text asked for a plural
  helper; the chosen wording does not need one). A Polish line with a link has two colons (the link): the "one colon at most" test
  of the weekly report uses a view with no link.
- Docs: `docs/capabilities/digest-and-notices.md` rule 3d.
- `TERMS_VERSION` not changed (counts and fixed words, no legal text or registry change).

## Mutation results (saved logs `.f120s06/logs/mut-*.log`, untracked)

Each guard was removed, its test failed, the code was restored. One equivalent mutant: `g5b` (the route's id check on POST: the
command re-checks the UUID, so removing the route check changes no answer; the check stays as a first line of defence).
