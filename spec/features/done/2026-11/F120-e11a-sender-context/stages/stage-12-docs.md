# F120 stage 12 — Docs

Part of [`../plan.md`](../plan.md). Decisions D2, D3, D14, D15; PD-106.

Carry-over reads: every landed F120 stage (git log), `docs/capabilities/README.md` (page shape), `docs/capabilities/trust.md` (rollout and rollback sections as a model), `docs/decisions/0034-sender-profiles-from-counts.md`, `docs/architecture.md` §5 and §7, `deploy/README.md`, stage 11 summary.

## Step 1 — capability page and cross-links

- New `docs/capabilities/sender-context.md` in the shape of the README: what it does, numbered rules (profile pass, privacy, suggestions, sender line, contact wait, known domains, classifier line and its eval result), flags, code map, data, limits, tests, decisions.
- Limits to state: the profile counts only mail that still exists after an erase (stage 04); a key change orphans rows until 12-month retention, and a DSR erase cannot find those old rows (they hold dates only); domain suggestions are not erased by an address erase (Q5); Telegram has no sender line (P2); the profile line is not in production (stage 11 verdict); known domains need Sent sync; the pass time measured in stage 03.
- Update: `retention.md` (12-month profile delete, suggestion rows), `account-data.md` (DSR find and erase counts, export address join), `open-loops.md` (contact wait replaces the limit line "a wait per contact (E11a) is not built"), `triage.md` (known domains, `classifier-v4`), `web-panel.md` (Suggestions card, sender line), `digest-and-notices.md` (weekly line, brief suffix), `docs/capabilities/README.md` index.
- `docs/architecture.md` §5 (two tables) and §7 (retention rows).
- ADR 0034: status accepted, date; a dated amendment: address rows only (D2), key derivation (D3), recompute instead of increments (D1).
- `deploy/README.md` § Sender context: flag order `sender_context` → (one day, check `contacts_refresh_done` lines) → `contact_wait` → `sender_suggestions`; rollback: flags off first; the migration is expand only; on a code rollback, before the old image starts: `UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact'` (the old loops code parses a strict enum), and fail the pending `weekly_report` rows whose view holds `suggestions` and the pending digests whose view holds the brief suffix data, for each view schema that is strict at `HEAD` (the worker checks and lists exactly those).
- A docs guard test like `open-loops-docs.test.ts` if the capability pages have one per page at `HEAD` (each flag and job named in the page exists in code).

## Step 2 — owner input

- The worker does not edit `docs/owner-decisions.md` (the coordinator owns it) and does not change the legal pages or `TERMS_VERSION` (Q2). The final message gives the privacy page sentence for the next legal batch: "The assistant keeps counts per sender (mails, answers, corrections, reply times) under a keyed hash, with no mail text, and deletes them 12 months after the last mail." and the matching Polish sentence.

## Done when

`bun run lint` passes on the docs checks the repo has (`capability-map.test.ts`, docs guard tests). Then the Proof command.

## First commit of this stage (carry-over from the stage 10 re-review, PASS 289b89fc)

Fix `docs/capabilities/triage.md` rule 17 cost lines (line ~92):
- The flag-off cost line is out of date: each batch also makes 1–2 `isFeatureOn` reads.
- The "about 1.3 s at 100000 mails" figure was the total of both reads. `suspiciousSenderDomains` alone takes about 360 ms.
- `userSentKey` counts all user Sent mail of any age on every batch (about 80 ms at 100000 rows); the doc calls it "cheap". State the number.
Optional test gaps (low risk, add if cheap): a test for the default `SENT_RECIPIENT_MAX_MAILS = 5000`; a test that `sent_at` (not `internal_date`) bounds the 90-day window. Accepted note: if the user mails a typo domain more often than the real one, the real domain gets `lookalike_domain` (false alarm only, never lowers suspicion).

## Carry-over from the stage 07 re-review (PASS 6a1e6606)

First commit of this stage (small, with a mutation log each):
- TG1: pin probe C16 as a command test in `contacts-suggestion-commands.test.ts`: the user wrote recently to `z@mail.acme.pl`, the domain blocklist row `acme.pl` must answer `not_available` on Accept (mutation m10: domain row re-check reads `{ address: row.pattern }` survives today; m07 subdomain LIKE).
- N1: the comment of `protectedNow` must say that a delegate committed while Accept waits for the row lock is not seen and the rule stays (not "withdrawn within the hour").
- N4: `moveFocus.current` in the suggestions card is cleared only when `data` changes; clear it when the reload fails, so a later poll does not move focus.
- N5: docs say "a 404 hides the card and stops its requests"; with the flag off and N mailboxes the card sends N list requests. Fix the doc line or stop after the first 404 for the flag.
- TG3 (cosmetic): the select lists mailboxes that answered 404 (mutation w02).

## Carry-over from the stage 11 review (PASS a1e1cfd1)

First commit of this stage:
- NOTE 1: `evals/results/2026-11-19-f120-v4-dev-summary.md` says spend $0.4149. The five dev runs sum to $0.4130 (report cost lines and ledger). Correct the figure.
- NOTE 2: `docs/capabilities/triage.md` line 3 still names `5ba3e0bc`. Update it to the checked commit. List `senderProfile` in the `ClassifierExtras` bullet of rule 18.
- TEST GAP 3: add an integration test that the triage job hands `readProfile` to `loadClassifierExtras` (review mutations m20 `main.ts` and m21 `classify-input.ts` survived).
- TEST GAP 4: `gateFileSchema.promptParts` must accept `profile` (m22 survived). Add a test.
- TEST GAP 1/2: pin the v3 text to a fixed expected text for all 8 part combinations (m12 survived).
- TEST GAP 5/6: a behaviour test for the v4 report `promptParts`, and one for the place of `PROFILE_RULE` (m23b, m27 survived).
- NOTE 4: `PROFILE_RULE` ("Relation known … means a real contact: it is not spam") is strong. Do not ship it without a new owner decision.
