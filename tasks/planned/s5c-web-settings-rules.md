> **Status 2026-11-08 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S5c Web: settings and rules

Scope: the S5 master plan `tasks/active/s5-web-panel.md` (P7, U8, D10 (b) (d) (e), D16, the API contract rows marked S5c, "Rules for every step"). Needs: S5a built and merged (S5b only for the mailbox list the selector shows; the route exists after S5b, else the selector reads `/api/mailboxes` once S5b lands).
Git mode: worktree (`task/s5c-web-settings-rules`). Run mode: pipeline.

## Goal

The owner changes the mailbox mode, the tool switches and the category `auto` flags behind the go/no-go gate, the digest times, the style text and the organization timezone from the web, manages the whitelist, blocklist and VIP rules, and changes the password. The CLI and the web call the same service functions.

## Done when

- Every setter of `mailbox:settings` has a web route with the same audit rows and the same gate-closing expiry (`SettingsDeps.expireReady` wrapper); the go/no-go gate lives in one service that the CLI and the route call (D10 (b)); the S3 CLI tests stay green.
- `auto … on` on a no-go category answers 409 `no_go` with `{ decision, precision, kept }`; "Set anyway" repeats with `force` and the audit row records `forced` (route test and Playwright).
- Timezone and style text change through `tenancy` setters with audit rows (no text in the audit data); the digest times through `setDigestTimes`; the page explains what follows the timezone (U8).
- Rules: list, add (address or domain, organization or one mailbox), delete; audit rows `rule.added` and `rule.removed` carry no pattern; `rules:add` writes the same row.
- Change password through Better Auth with other sessions revoked; the audit row `web.password_changed` exists (D4).
- Playwright in both projects: the mode dialog, a switch, a no-go `auto` refusal and "Set anyway", a rule add and delete, a timezone change.

## Owns (from the master plan)

- Decisions D10 (b) gate service, D10 (d) tenancy setters, D10 (e) rule delete and audit, D16 settings over the web.
- Contract rows: `PATCH /api/organization`, `PATCH /api/me/digest-times`, `GET /api/settings/:mailboxId`, `PATCH /api/settings/:mailboxId/mode`, `…/switches/:name`, `…/auto/:category`, `GET /api/rules`, `POST /api/rules`, `DELETE /api/rules/:id`, the `change-password` wrapper.
- New files (expected): `apps/server/src/modules/triage/gate.ts`, `apps/server/src/modules/triage/routes.ts` (the `auto` route; S5d adds its routes to the same file), `apps/server/src/modules/config/routes.ts`, `packages/core/src/web/{settings,rules,organization}.ts`, `apps/web/src/islands/{Settings,Rules}.tsx`, `apps/web/e2e/{settings,rules}.spec.ts`.
- Changed files (expected): `apps/server/src/scripts/{mailbox-settings,rules}.ts` (call the services), `tenancy/{repo,service,index,routes}.ts`, `config/{repo,service,index}.ts`, `audit/repo.ts` (events `org.timezone_changed`, `org.style_changed`, `rule.added`, `rule.removed`), `apps/web/src/i18n/en.ts`.

## Stage sketch

1. **Gate service**: `triage/gate.ts` (`goNoGoFor`, `setCategoryAutoWithGate`, `GateRefused`), `mailbox-settings.ts` refactor; tests.
2. **Tenancy setters and rule audit**: `setOrganizationTimezone` (IANA check), `setStyleText`, `deleteSenderRule`, the four audit events, `rules.ts` refactor; tenant-filter tests for each new repository function.
3. **Routes** `[risky]`: `config/routes.ts`, the `auto` route, `tenancy/routes.ts` additions, the change-password audit wrapper; the route matrix; `no_go` 409 shape.
4. **Settings page**: mailbox selector; cards Mode and actions (the `assist` dialog lists the switches it turns on), Categories (auto, threshold read-only, go/no-go state, Set anyway), Digest and style, Organization (timezone search list, the note of U8, retention read-only), Account (change password, sign out everywhere); strings; both widths.
5. **Rules page**: three lists, add form (kind, pattern with the address-or-domain check from the core schema, scope), delete; empty states.
6. **Playwright and notes**; group review.

## Page-level questions for the plan session

Which settings sit on one screen and which behind tabs on the phone; the wording of the go/no-go state ("no-go: precision 83.6 %, 55 labels; the bar is 98 %"); the confirmation text of the `assist` switch; how the style text is explained (used in drafts; the signature); the timezone list UX (search box, current value first).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (the S5 docs pass is S5e; this segment writes its notes).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session (`tasks/active/s5-web-panel.md`, P11).
