# F116 stage 24 — Docs and ADR

Part of [`../plan.md`](../plan.md). Needs stages 01–23. Docs only; no code change except a doc test that fails.

## Step 1 — ADR

- **Goal:** a new ADR (the next free number in `docs/decisions/`, "Open loops: one module, one chaser, a loop anchor for actions"), status `accepted`.
- **Content:** D1–D4 and D17 with their rejected options; the consequence for later kinds (E6 may replace the `follow_up` template if the E2a judge shows a gain; E11a replaces `loop_wait_days` per contact); the link to ADR 0029 (read Sent) and ADR 0023 (commands).

## Step 2 — Capability pages

- **Goal:** the pages say what the code does at the land commit (the `docs/capabilities/README.md` form: what it does, rules, entry points, data, limits, decisions, tests).
- **Files:**
  - New `docs/capabilities/open-loops.md`: kinds, analysis (filters, extractor, dates), close rules, taps and commands, the chaser, follow-ups, the brief, the consent gate, switch-off, retention, flags, log lines, tests.
  - `delegation.md`: the chaser moved (D3), `delegations.source`, the Delegate command, hand forwards as `delegated` loops; drop the E5b limits that are now built.
  - `digest-and-notices.md`: the brief sections, the count line, the Delegate button and picker, the loop buttons.
  - `drafts-and-send.md`: kind `follow_up`, the loop anchor, `to ∪ cc` in the envelope and the limits.
  - `sent-mail.md`: Limits ("no analysis" is gone; the switch-off hook); `measurement.md` (M2 split); `retention.md` (loop texts, 90 days); `account-data.md` (the new export and address-map entries); `web-panel.md` (the Open loops page, the settings card, the consent button).
- **Decisions:** `docs/architecture.md` gets `loops` in the module list and the reply branch of §4.1 notes "loops.match closes Waiting loops". `docs/code-patterns.md` gets a short "An action on a loop" entry next to "add an action type" (the anchor rule, `emailIdOf`, the hook).
- **Test:** T1 the docs tests that exist (links, the capability table, the entry-point names) pass.

## Step 3 — Edits outside the code docs

- **Goal:** the final message lists, for the coordinator, the edits this stage may not make: `spec/build.md` (the NEXT line) and the cross-epic notes of E05 discovery §6 (E3 M2 split, E4 history check, E6, E7 papers: "sent mail headers and text" and loop texts as processed data, E9 adapters, E11 wait per contact).
- **Done when:** the list is in the final message.

## Done when (stage)

Steps 1–3 hold; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s24`).

## Out of scope

The pilot (25).
