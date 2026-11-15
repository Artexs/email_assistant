# F109 stage 16 — Capability pages, results note, send-limit re-check

Part of [`../plan.md`](../plan.md). Decisions D18 and PD-009 (a capability page is true after each epic). Needs all other stages landed or marked skipped. No product code, no LLM spend.

## Step 1 — Capability pages

**Goal.** `docs/capabilities/` says what the code at HEAD does after F109.

**Pages and content.**

- `triage.md`: rule for the suspicious reasons (six codes, the known-sender rule, trusted `authserv-id`, `MAIL_TRUSTED_AUTHSERV_IDS`), the flag `suspicious_mail` and its effect on `delegation` mail; the classifier prompt in production and its parts (from stage 11); `ClassifierExtras` sources; escalation (trigger, role, flag, config) or "not built: stage 13 said no ship" with the link to the summary; the eval flags `--suspicious`, `--prompt-version`, `--prompt-parts`, `--escalate`. Remove the "no phishing flag, no attachments, no urgency context" limit; add the limits that remain (no password-protected archive check; `auth_fail` silent without a trusted header; a forged own address or own domain counts as known; lab-01 phishing comes from one look-alike persona; folder hint and cold-mail code not built, D14); the v3 rollback rule of stage 11.
- `digest-and-notices.md`: the warning line, the attachment line, the `not_triaged` notice (pause source, cap, quiet hours, texts), their flags.
- `retention.md`: `suspicious_reasons` are codes and stay; `urgency_profile` follows the mailbox settings row.
- `web-panel.md` or the settings page that lists commands: `PUT /api/settings/:mailboxId/urgency` and the CLI `mailbox:settings urgency`.
- `measurement.md`: only if a metric reads a new field (none planned; leave it unchanged otherwise).
- Each changed page gets "Checked against the code at `<sha>`, <date>".

**Check.** Every route, flag, CLI command and config key named on a page exists at HEAD (grep each one; list them in the final message).

## Step 2 — Results note

**Goal.** A later agent finds the F109 numbers without reading every report.

**File.** `notes/2026-11-15-e3b-improve-results.md` (use the date of the stage), with links: stage 05 holdout numbers against the targets; the stage 09 `Chosen parts:` and `K` per variant; the stage 11 decision and the production prompt; the stage 13 decision; the total spend of stages 09, 11, 13.

Also read `notes/2026-11-13-measured-core-facts.md` again: if the F100 pilot probe (C2) has added the `Authentication-Results` line, write in the results note whether `interia.pl` is the `authserv-id` (then `auth_fail` works on the pilot without `MAIL_TRUSTED_AUTHSERV_IDS`). Else write "N1 still open".

## Step 3 — Send-limit re-check (PD-044, PD-068)

**Goal.** One offline count says whether the PD-044 limits (20 sends per mailbox per rolling hour, 100 per 24 h, 5 per recipient per 24 h) fit the simulated week.

**Decisions (D18).** A throwaway script in a temp folder inside the worktree (not committed) reads `evals/sim/lab-01/week/slots/` and counts, per rolling hour and per rolling 24 h, the mails whose truth is `delegation` (each would be one delegation send after approval), and per delegate per 24 h. The note gets the three maxima against the three limits and one line: "fits" or "would hold sends: <which limit>". No limit changes in F109; a limit that does not fit is a question in the final message.

**Test.** None (docs and a note).

**Check.** `bun run lint` on nothing new; then the Proof (docs-only stages still run it).

**Done when.** The pages and the note are committed; the final message lists the checked names and the three send-limit maxima; Proof `PROOF_OK`.

**Out of scope.** `docs/product/stage-2/*` and other epics' pages: the final message lists the edits that the coordinator applies (the E3 epic page status line, the §2.1 row 15 stage count).

## Carry-over from stage 03 review

- Copy the accepted limits of stage 03 into the capability page: a forged own address or org domain counts as known (only `auth_fail` catches it); CEO names that are not members, delegates or VIPs are not protected; old rows read as `{}`; the error path stores `{}`. Source: `notes/2026-11-15-f109-s03-suspicious-triage.md`.
- With the flag off, reasons are stored and the plan is unchanged; each batch loads the context (up to 4 queries) and each mail reads its header row (1 query). Say so (the stage text, not "no extra query").

## Carry-over from stage 04 review

- Clarify the consent rule in `docs/code-patterns.md` (§ The consent version, "a new field of a notice"): bump `TELEGRAM_CONSENT_VERSION` when a new kind of mail-derived data reaches Telegram (addresses, names, domains, subject, body, attachment names or types, link hosts). Fixed phrases that our own code picks from our own codes (the suspicious warning line, category tags, would-do phrases) do not bump. Source: `review-4.md` N2.
