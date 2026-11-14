# F107 stage 05 — DPIA, records of processing, breach procedure

Part of [`../plan.md`](../plan.md). Decisions P2, P3, P6, D8, D12. Needs stage 04. English only (Q4). Sources as stage 03, plus `docs/known-alerts.md`, `deploy/README.md` (Update, Roll back, Backups, Account data), ADR 0024 (proposed: the E8 alert frame).

## Step 1 — Records of processing (Art. 30)

**Goal.** `docs/legal/records-of-processing.md`: two records, one as controller (account data of members) and one as processor (the mail of each organization).

**Decisions.**
- Each record has the Art. 30(1) or 30(2) points as `##` or table rows: name and contact (placeholders), purposes, categories of subjects and data, recipients (the sub-processor ids of the registry), transfers outside the EEA, time limits, security measures (link to the DPA Annex 1 page path).
- One table row per data category, with the id in backticks (D8), its tables and its `kept` rule.

## Step 2 — DPIA draft (Art. 35)

**Goal.** `docs/legal/dpia.md`: a draft impact assessment for the processing of executives' mail with an LLM.

**Sections (`##`, in order).** Description of the processing; Necessity and proportionality; Risks; Measures; Residual risk; Decision (`<to confirm: DPIA decision>`).

**Decisions.** The risk list holds at least: mail text at an LLM provider in the US; Telegram outside the EU, not end-to-end encrypted; prompt injection in mail; a wrong automatic move; a wrong recipient in a draft; a stolen VPS or backup; a missed `org_id` filter; a lost mailbox secret. Each risk has its measures with a source (a test, an ADR or a capability page) and a likelihood and severity of `low`, `medium` or `high`, chosen by the worker and named in the final message.

## Step 3 — Breach procedure (Art. 33, 34)

**Goal.** `docs/legal/breach-procedure.md`: the steps from the first sign to the notices.

**Sections (`##`, in order).** Detect; Contain; Assess; Notify the controller; Notify the authority and the people; Record; After.

**Decisions.**
- Detect: the Healthchecks.io alert, operator notices, `docs/known-alerts.md`; E8b replaces this with its alert runbooks (D12).
- Contain: the rollback of `deploy/README.md`, rotation of `CREDENTIALS_KEY`, `WEB_AUTH_SECRET`, the bot token and mailbox passwords (name the steps; link the existing runbook sections; write no new runbook).
- Notify the controller: without undue delay, target 24 hours after awareness (default, owner to confirm in `questions.md` Q9).
- The controller notifies the supervisory authority (UODO) within 72 hours (Art. 33(1)) and the people when the risk is high (Art. 34).
- Record: every breach goes to the breach register at `<breach register location>`, outside this public repository (Q5); the register entry holds facts, effects and measures (Art. 33(5)).

## Step 4 — Index and checks

**Files.** `docs/legal/README.md` (one line per paper, and the six in-app pages by route); a unit test in `apps/server/src/` next to the capability map test.

**Test.**
1. Every `dataCategories` id appears in backticks in `records-of-processing.md`; the test names the missing ids.
2. Every `subprocessors` id with `personalData: true` appears in backticks in `records-of-processing.md`.
3. `dpia.md` and `breach-procedure.md` hold the `##` headings above, in order (exact text).
4. Every repo path in backticks in `docs/legal/*.md` exists (the capability map test does the same for its pages; reuse its helper if it is exported, else a local one).

**Check.** The new unit test; `bun run test:unit:ci` for the capability map test.

**Done when.** Tests 1–4 pass and the Proof prints `PROOF_OK`. The final message lists the chosen risk levels.

**Out of scope.** The claims list (06), the in-app texts, new runbooks (E8b).
