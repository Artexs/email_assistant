# F117 stage 02 — Spike report and the second-pass input

Part of [`../plan.md`](../plan.md). Needs stage 01 and owner step U1: the coordinator commits `spike-result-microsoft.json`, `spike-result-microsoft-personal.json` and `spike-result-google.json` in the ticket folder first. If a file is missing, stop and say so.

## No live run (owner, 2026-11-15)

The owner skipped U1: no result files exist, and that is not a stop. Write `spike.md` anyway:
- Every row of stage 01 has the verdict `NOT RUN` and, as evidence, the default that the later stages use (the bracketed defaults of stages 14 and 15, and D-lines of `plan.md`).
- Gate lines: `M3: ASSUMED PASS (not proven live)`, `G2: ASSUMED PASS (not proven live)`.
- Plan changes: one line for stage 14 (or a stage 06/08 refresh, if the code needs it): the Microsoft code redeem must get an `id_token` without a live check, so add `openid` to the Microsoft redeem scope (the fix that the stage 08 review and stage 14 carry-over name). Other rows: "none (default kept)".
- Second-pass text: "Accepted on the defaults; to prove at the first live run (stage 01 kit, then stage 21)".
- A section "Not proven live" that lists each row, so stage 19 docs can copy it.

## Step 02.1 — `spike.md`

**Goal.** Turn the three result files into the facts the later stages and the owner's second pass (PD-086, PD-087) need.

**Files.** `spec/features/<lane>/F117-e9a-mailbox-oauth/spike.md` (new). Nothing outside the ticket folder.

**Content.**
1. A table: row id, verdict, evidence (copied from the result file), and the decision or stage that the row confirms or breaks.
2. Gate lines: `M3: PASS|FAIL` (PD-086), `G2: PASS|FAIL` (PD-087).
3. Facts for later stages, each with its row:
   - Microsoft folder names and special-use flags (M4) → stage 14 folder map.
   - The address claim (M12) → D12, stage 08.
   - Rotation and old-token validity (M11, G6) → D14, stage 10.
   - Error and AADSTS codes seen (M1, M13, M14, G6) → the stage 06 error map, stage 14 admin consent.
   - Graph Message-ID, `X-EA-Action-Id`, `Bcc`, size limit (M10) → stage 13.
   - Gmail label, Sent and Drafts behaviour (G3–G5) → stage 15.
   - Draft in thread (M6, G4) → the reply-drafts ticket (E6a, F115); report only.
4. "Plan changes": one line per stage that a fact changes (stage, what, why). No change → "none".
5. A proposed second-pass text for PD-086 and PD-087 (accept as decided, or the fallback and its size).

**Decisions.** D1, gate G1.

**Test.** None (no code).

**Check.** `test -s spec/features/<lane>/F117-e9a-mailbox-oauth/spike.md && git status --porcelain -- apps packages db tools` prints nothing for the second part.

**Done when.** `spike.md` has every row of stage 01 with a verdict and evidence, the two gate lines, and the plan-change list. Commit it alone. The final message gives the gate lines and the plan-change list first.

**Out of scope.** Editing other stages (the coordinator runs a refresh job), editing ADR 0031 (stage 19), `docs/product/stage-2/` (the coordinator).

## Carry-over from the stage 08 review

Source: `review-8.md` (U1).

- **ID token at the code redeem.** `redeemCode` sends `scope` = the mail resource scopes only (IMAP and `offline_access`), with no `openid`. It was not checked whether Microsoft then returns an `id_token`. If it does not, `finishOAuthCallback` refuses every Microsoft connect with `oauth_failed` (no ID token, no address). Record in the rows M2 and M12: does the redeem answer hold `id_token`? Which claims does it hold (`email`, `preferred_username`, `tid`, `aud`, `iss`)? If no `id_token` comes, the fix is to add `openid email profile` to the `scope` of `redeemCode`, or to read the address another way: a stage 06/08 refresh job.
