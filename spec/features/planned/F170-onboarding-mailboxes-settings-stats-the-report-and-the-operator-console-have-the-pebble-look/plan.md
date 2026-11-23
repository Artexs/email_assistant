# F170 plan — the Pebble look for the setup and control pages

> **Status 2026-11-24 — planned.** Plan base: 8ae05d319. Ten stages; nothing built. No owner step is open. Cold review not run yet (§ Cold review).

Shared decisions (PB-1…13, DB-1…11, § Rules for width): [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Design system names: `spec/features/*/F166-*/interfaces.md`. The drawing: `design/ui-proposals/proposals/03-pebble/` (shots `07-*`, `04b-*`, `04c-*`, `06a-*`, `06b-*`).

## Input

The owner's words are on the programme page. This ticket adds no new owner words. Defaults this plan takes are in [`questions.md`](questions.md).

### Product decisions

- **P1 Onboarding mode cards** (PB-5; default, owner to confirm). The mode step (flag `trust_ladder` off) shows a Shadow and an Assist card. A card explains; it is not a control. Shadow holds today's "Keep shadow mode" button (`POST /api/onboarding/keep-mode`). Assist holds one button: with one mailbox it opens the Settings `AssistDialog` with the same mode call; with two or more it links to `/settings`; with none it shows "Connect a mailbox first." Rejected: a card tap that sets the mode (a second way); a link only (the ticket asks for the dialog).
- **P2 Pause stays** (PB-4; default). Today a mailbox has Pause and Resume. They stay. PB-7 cuts the mockup's "mails today" number, not today's control.
- **P3 Six mailbox card states**: connected, never synced, paused, login error, server refused, access revoked (`auth_error` with `authMethod: oauth`). An OAuth card shows no "Change password" (always `409 oauth_mailbox`); the revoked card offers today's connect dialog. Default, owner to confirm.
- **P4 No mode toggle on a mailbox card** (PB-4). The card shows the mode as a `Badge`. The automatic-action switches stay in Settings.
- **P5 Settings sections.** Four groups in this order: This mailbox (`#mailbox`), Digests and notices (`#notices`), Organization (`#organization`), Account and security (`#account`). A row of four links under the page head; on a phone it wraps and does not stick; from `lg` it is a sticky side column. Rejected: a sticky phone row (it needs the shell's top bar height, a shell contract).
- **P6 Stats head.** Above the table: a ring of the handled share and three `StatTile`s, all from `weeks[0]` (the API sends the newest week first): handled = `m4.handled` of `m4.triaged`; serious mistakes = `m3.total`; urgent p90 = `m5.p90Minutes`; closed on time = `m2.closedOnTime` of `m2.due` (the label is the loops label while `m2.byKind` is set, as in the table). A dash where the table shows one. No hours saved, no weekly bar chart (PB-7).
- **P7 Report.** One card per category: `CategoryPill`, a status `Badge`, a ring of `wouldMove` of `total`. The one "Turn on recommended" button stays; no button per card (PB-5).
- **P8 Operator** (PB-11). Tokens and primitives only; tables stay dense (36 px controls). No layout change.
- **P9 Page head** (DB-9, PB-8). Each stage file fixes the English lead; the Polish has no gendered form. Only Mailboxes passes an action ("Connect mailbox").

### Design decisions

- **D1 Stage ownership** (Rules for width 1). Each stage owns the files listed in its stage file. Shared within F170: `MailboxSelector` and `AssistDialog` belong to stage 02, `StatusBadge`, `ScopeBadges`, `lib/mailbox-status.ts` and `components/telegram/` to stage 07, `SettingsPage.tsx` to stage 01. Another stage uses them unchanged.
- **D2 `useModeChange`** (stage 01, used by stages 02 and 06), `apps/web/src/lib/use-mode-change.ts`:
  `useModeChange(mailboxId: string, handlers: { onChanged(change: SettingsWebChange, mode: "shadow" | "assist"): void; onFail(error: unknown): void }): { pending: boolean; change(mode: "shadow" | "assist", keepSwitches: boolean): Promise<void> }`. It calls `patchSettings(mailboxId, "/mode", …)` exactly as `ModeCard` does today.
- **D3 Settings frame** (stage 01). A group is a named region whose label is not a heading; the cards stay the `h2` (`SectionCard`). Interfaces in the stage file.
- **D4 Each settings card is one `SectionCard`** with its `data-card` name unchanged; no card merges with another. The `id="two-factor"` and `?two_factor=required` stay. New `data-card` names: `security` and `delete-organization` (stage 05).
- **D5 Text keys.** A new key goes next to the keys of its page in its group file (`texts/en-<group>.ts`, `pl-<group>.ts`); lead keys are `set_lead`, `mb_lead`, `ob_lead`, `stats_lead`, `rep_lead`, `op_lead`. A key no file reads any more goes in the same stage (DB-10).
- **D6 Load and empty states.** Skeletons keep `aria-busy="true"`. An error keeps its text and Retry. "Nothing here" is an `EmptyState`; a flag-off text (`stats_off`, `rep_off`) is a `FactBox`.
- **D7 Contact sheet.** A state that the sheet lacks for a page gets its row next to that page's rows. `/operator` is not in the sheet: its stage saves its own pictures.
- **D8** A gap or a deviation is a question in the final message, not a choice.

## Facts checked (2026-11-24, at 8ae05d319)

- Settings: 15 `data-card` names; the only anchor is `id="two-factor"` (`?two_factor=required` scrolls to it); no link points to another settings hash. `AccountCard` holds two-factor, the security log and the delete block in one `Card`.
- Mailbox statuses: `active`, `paused`, `auth_error`, `host_blocked`; the panel reads `authReason` nowhere. The password route answers `409 oauth_mailbox` for an OAuth mailbox; the OAuth callback has a `reconnected` result.
- The mode step is done after `mailbox.mode_changed` or `onboarding.mode_kept` (`web-route-deps.ts`).
- `/operator` answers the 404 page to a non-operator; the e2e server has no operator; specs fake answers with `page.route`.
- The docs shots wait for the title heading and for no `[aria-busy="true"]`. Capability rule 9 holds every page on one line.

## Not verified

- A page answer from `page.route` with the built `apps/web/dist/operator/index.html` loads its `/_astro/` files and runs the island: stage 10 checks it first (fallback in the stage).
- A sign-in with the account of an existing OAuth mailbox answers `reconnected`, not a refusal: stage 07 reads `apply.ts` first (fallback in the stage).

## Done when

The acceptance list of [`ticket.md`](ticket.md) holds (6 items).

## Rules for every stage

- Read the programme page, this file, the F166 `interfaces.md` and your stage file; open the mockup screen and shots of your page.
- Token classes only; no palette class, hex value or inline `style` (DB-2). No feature flag (PB-1). No API, schema, URL or query change (DB-1).
- Keep every `data-*` attribute, `id`, text key in use and API call. Edit no file that another stage owns (D1); format only your files.
- Page head: pass `lead` (and `action`) to `AppShell`; no `h1` in the island (DB-9).
- Update your page's part of `docs/capabilities/web-panel.md` and its user docs page in English and Polish (DB-11). Rule 9 there is one line: a land conflict on it is "merge `master`, prove again".
- Run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`; compare phone and desktop, both schemes and languages, with the mockup shots; name the paths in the final message.

## Proof

`mkdir -p /tmp/f170-NN && bun run check:job > /tmp/f170-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f170-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts <the specs of the stage> patterns.spec.ts > /tmp/f170-NN/e2e.log 2>&1 && echo PROOF_OK`

The final message copies the last line of `check.log`.

## Owner checkpoints and steps

None here; the owner's look is in the release ticket (PB-12).

## Review

A Sonnet review before each land. Its task adds: "Open the worker's pictures and the mockup shots; report each difference from the mockup's pattern and each control that moved, was added or was lost."

## Stages

| # | Stage | Needs (first line of the stage file) |
| --- | --- | --- |
| 01 | [Settings frame, sections, nav, `useModeChange`](stages/stage-01-settings-frame.md) | F166 09, 10 |
| 02 | [Settings: mailbox cards](stages/stage-02-settings-mailbox.md) | 01 (`useModeChange`); F166 06, 10 |
| 03 | [Settings: reply style](stages/stage-03-settings-reply-style.md) | F166 10 |
| 04 | [Settings: notices and organization](stages/stage-04-settings-notices.md) | F166 10 |
| 05 | [Settings: account and security](stages/stage-05-settings-account.md) | F166 10 |
| 06 | [Onboarding](stages/stage-06-onboarding.md) | 01 (`useModeChange`); F166 06, 09, 10 |
| 07 | [Mailboxes](stages/stage-07-mailboxes.md) | F166 06, 09, 10 |
| 08 | [Stats](stages/stage-08-stats.md) | F166 06, 09, 10 |
| 09 | [Shadow report](stages/stage-09-report.md) | F166 06, 09, 10 |
| 10 | [Operator console](stages/stage-10-operator.md) | F166 03, 09 |

Eight stages start at once (01, 03, 04, 05, 07, 08, 09, 10); 02 and 06 start when 01 lands.

## How to run (coordinator)

As for F166: folder in `active/` and committed first; one job per stage with the board's worker flags and `--prepare 'bash scripts/limen-prepare.sh'`; task text "Implement F170 stage NN. Read the programme page, the F166 `interfaces.md`, and ticket.md, plan.md and stages/stage-NN-<slug>.md here; final proof: § Proof with the specs of the stage; list as proven only what a saved log shows." Land with `--keep-open` except the last; drop the job DB and the job's sheet folder after each land.

## Planning progress

Stages 01–10 [written]. Scouts: 0 (the job instruction forbids waiting for or polling a job; the planner read the code itself). Word counts: § Log.

## Cold review

Not run: the job instruction forbids `limen wait` and polling a job. Model: `claude-sonnet-5-5` (no `[risky]` stage, no risk area). The coordinator runs it before the first spawn (`plan-review-1.md`).

## Log

- 2026-11-24: plan written at 8ae05d319.
