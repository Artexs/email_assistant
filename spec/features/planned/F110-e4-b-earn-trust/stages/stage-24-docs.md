# F110 stage 24 — Docs

Part of [`../plan.md`](../plan.md). Docs only; no code. Needs stages 01–23 landed (or 01–20 when the coordinator cut 21–23: then leave out the unsubscribe parts and write the cut into `docs/capabilities/web-panel.md` § Limits).

## Step 1 — Capability pages

- **Goal:** `docs/capabilities/` says what the system does after F110, checked against the code at `HEAD`.
- **Files and content:**
  - `triage.md`: rule 16 "For F110" bullet replaced by the grant key and the re-gate (D7, D8); a new rule "Evidence for `auto`" (D1–D5, D9, flag `trust_ladder`); limit line "The gate on real labels … stays until ADR 0028" rewritten (it is a block now, with the flag on); entry points `trust.history`, `trust.regate`, `trust.tripwire`, `trust:history-check`.
  - `sync.md`: the history backfill mode (D10), report mail skipped by the own-mail check (D14), `list_unsubscribe_post` in rule 18.
  - `digest-and-notices.md`: the two new kinds in the rule 5 table; per-user quiet hours (rule 6 "Check against the code" line about the constant); the mail channel (rules 3, 7); why-line suffixes and the spam line in rule 4.
  - `measurement.md`: remove the limit "The holdout result, the history check and the tripwire are not in M8: F110"; rule 9 complete.
  - `web-panel.md`: the report page, the card lines, the panel review, the urgency card, the notify card, the newsletters list; flags.
  - `account-data.md`: the new tables in the export and delete lists.
  - New page `docs/capabilities/trust.md` if the triage page passes ~250 lines with the new rule; link it from `README.md`.
- Each page keeps its "Checked against the code at `<sha>`" line, updated to `HEAD`.

## Step 2 — ADRs and architecture

- ADR 0028: status `accepted (F110, <date>)`; one line under Decision point 2 with the D4 outcome rule and a link to `questions.md` Q2.
- ADR 0022: status `accepted (F110)`; point 2 names the outbox id as the header value (D14).
- `docs/architecture.md` §4.3: "A category gets automatic moves only after it passes the go/no-go bar" → the ADR 0028 evidence rule; §4.1 and §6.1 list INBOX as a folder the system writes to (report mail only) and the history backfill.
- `docs/owner-decisions.md` is not edited here (coordinator only).

## Check

`bun run lint` (markdown lint, if configured) and a manual read: every rule names a code path that exists at `HEAD` (grep each named function once).

## Done when

- Proof (`s24`) prints `PROOF_OK`.

## Out of scope

`docs/product/stage-2/*` and `spec/build.md` (the coordinator edits them; plan final message lists the edits).
