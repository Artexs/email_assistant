# F110 stage 25 — Docs

Part of [`../plan.md`](../plan.md). Docs only; no code. Needs stages 01–24 landed (or 01–21 when the coordinator cut 22–24: then leave out the unsubscribe parts and write the cut into `docs/capabilities/web-panel.md` § Limits).

## Step 1 — Capability pages

- **Goal:** `docs/capabilities/` says what the system does after F110, checked against the code at `HEAD`.
- **Files and content:**
  - `triage.md`: rule 16 "For F110" bullet replaced by the grant key and the re-gate (D7, D8); a new rule "Evidence for `auto`" (D1–D5, D9, flag `trust_ladder`); limit line "The gate on real labels … stays until ADR 0028" rewritten (it is a block now, with the flag on); entry points `trust.history`, `trust.regate`, `trust.tripwire`, `trust:history-check`.
  - `sync.md`: the history backfill mode (D10), report mail skipped by the own-mail check (D14), `list_unsubscribe_post` in rule 18.
  - `digest-and-notices.md`: the two new kinds in the rule 5 table; per-user quiet hours (rule 6 "Check against the code" line about the constant); the mail channel (rules 3, 7); why-line suffixes and the spam line in rule 4.
  - `measurement.md`: remove the limit "The holdout result, the history check and the tripwire are not in M8: F110"; rule 9 complete. M7 cost includes history-check calls (`data.historyCheckId`).
  - `web-panel.md` § Limits or the unsubscribe page: one-click trusts `dkim=pass` of a trusted authserv-id, not proof that DKIM covers the `List-Unsubscribe` headers (review 1 N11).
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

- Proof (`s25`) prints `PROOF_OK`.

## Out of scope

`docs/product/stage-2/*` and `spec/build.md` (the coordinator edits them; plan final message lists the edits).

## Carry-over from stage 05 review

- N3/N4: account-data.md line 83 and sync.md rule 19 must name the automatic history check at connect (mail with no tombstone); retention counts from created_at, onboarding text must not suggest a 30-day age limit (review-5.md).

## Carry-over from the stage 24 review

- Document the replay limit (review-24.md NOTE 1, 2, 4, 8): DKIM coverage of the List-Unsubscribe headers is NOT checked; the cheap mitigation refuses a mail with more than one such header; the target comes from the newest mail with a result; NAT64 answers are refused; the domain limit counts an attacker-chosen domain.
- Open a ticket for the full DKIM `h=` coverage check (new captured data).
