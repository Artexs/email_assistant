# F109 stage 05 — Phishing sim measurement (no LLM)

Part of [`../plan.md`](../plan.md). Decisions P1, D7. Needs stage 01 (stage 03 for the free-mail list). No LLM call, no spend.

## Step 1 — `--suspicious` eval mode

**Goal.** `bun run eval --sim lab-01 --part dev|holdout|week --suspicious [--out <file.md>]` runs `assessSuspicious` on every case and writes a report. No provider key needed; it refuses `--judge` and `--model`.

**Decisions (sim mapping, D7).**

- `fromAddress` and `fromName` from the case `from` (`Display Name <address>`).
- `replyTo` and `authResults` from `sim.headers` (`Reply-To`, `Authentication-Results`; lab-01 has none, so `auth_fail` and `reply_to_mismatch` stay at 0 there); `isList` from `List-Id` or `List-Unsubscribe` in `sim.headers`.
- `links` from the case HTML with the link extractor that header capture uses (F100, `mail/imap/capture.ts`). If module borders forbid the import, move the pure extractor to core and import it from both places; same output.
- `attachments` from `sim.attachments` names; type from the extension (a small map; unknown → `application/octet-stream`).
- Known senders (the sim stand-in for D4): the company domain, delegates, the case's sender rules (VIP, whitelist), and personas of the groups `team`, `delegate`, `client`, `vendor`, `boss`, `partner`. `knownDomains` = their registrable domains plus the free-mail list. `protectedNames` = display names of delegates and VIP personas. `trustedAuthservIds` = `[]`.
- A case is "phishing" when it has a `phishing_*` hard-case tag; "whitelisted" when its sender matches a whitelist or VIP rule of the case.

**Report (counts only on holdout; the dev report may list case ids).** Per `phishing_*` tag: flagged / total. Whitelisted cases flagged. Non-phishing cases flagged, with the rate and the truth category of each flagged case. Counts per reason code. Corpus name, version and manifest hash.

**Test (unit).** 1. A three-case fixture (one look-alike phishing, one whitelisted, one newsletter with a link whose text host equals its host) → 1/1, 0, 0. 2. `--suspicious --judge` → usage error, exit 1. 3. A holdout fixture report has no case id.

## Step 2 — Runs and target

**Goal.** The numbers of the rules on lab-01 are known and committed.

**Targets (default, owner to confirm, Q4).** On the holdout: phishing recall ≥ 90% (of the 21 cases), 0 whitelisted cases flagged, non-phishing flag rate ≤ 2%.

**Procedure.**

1. Run on `dev`. When a target fails on dev, change a rule in `suspicious.ts` (each change gets a unit test with a fixed value that names the case pattern, not the case id), and run `dev` again. At most 3 dev rounds.
2. Run on `holdout` once. If a target fails, one more dev-only fix and one more holdout run; at most 2 holdout runs.
3. Run on `week` once (for E2b's later week scorer; no target).
4. Commit the reports as `evals/results/2026-MM-DD-sim-lab-01-<part>-suspicious.md`.

If the holdout misses a target after 2 runs: commit the reports, keep the flag `suspicious_mail` off, and write the miss and the reason in the final message. That is not a stage failure.

**Check.** The unit tests, then the Proof.

**Done when.** Tests 1–3 pass; the dev, holdout and week reports are committed; the final message states the three holdout numbers against the targets; Proof `PROOF_OK`.

**Out of scope.** New corpus cases (lab-01 v1 is frozen; a corpus with `Authentication-Results` and `Reply-To` is E2b's), any LLM run.
