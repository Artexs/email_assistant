# F120 stage 12 — Docs

Part of [`../plan.md`](../plan.md). Decisions D2, D3, D14, D15; PD-106.

Carry-over reads: every landed F120 stage (git log), `docs/capabilities/README.md` (page shape), `docs/capabilities/trust.md` (rollout and rollback sections as a model), `docs/decisions/0034-sender-profiles-from-counts.md`, `docs/architecture.md` §5 and §7, `deploy/README.md`, stage 11 summary.

## Step 1 — capability page and cross-links

- New `docs/capabilities/sender-context.md` in the shape of the README: what it does, numbered rules (profile pass, privacy, suggestions, sender line, contact wait, known domains, classifier line and its eval result), flags, code map, data, limits, tests, decisions.
- Limits to state: the profile counts only mail that still exists after an erase (stage 04); a key change orphans rows until 12-month retention; domain suggestions are not erased by an address erase (Q5); Telegram has no sender line (P2); the profile line is not in production (stage 11 verdict); known domains need Sent sync; the pass time measured in stage 03.
- Update: `retention.md` (12-month profile delete, suggestion rows), `account-data.md` (DSR find and erase counts, export address join), `open-loops.md` (contact wait replaces the limit line "a wait per contact (E11a) is not built"), `triage.md` (known domains, `classifier-v4`), `web-panel.md` (Suggestions card, sender line), `digest-and-notices.md` (weekly line, brief suffix), `docs/capabilities/README.md` index.
- `docs/architecture.md` §5 (two tables) and §7 (retention rows).
- ADR 0034: status accepted, date; a dated amendment: address rows only (D2), key derivation (D3), recompute instead of increments (D1).
- `deploy/README.md` § Sender context: flag order `sender_context` → (one day, check `contacts_refresh_done` lines) → `contact_wait` → `sender_suggestions`; rollback: flags off first; the migration is expand only; on a code rollback fail pending `weekly_report` rows whose view holds `suggestions` and pending digests whose view holds the brief suffix data (the old schemas are strict) — the worker checks which views are strict at `HEAD` and lists exactly those.
- A docs guard test like `open-loops-docs.test.ts` if the capability pages have one per page at `HEAD` (each flag and job named in the page exists in code).

## Step 2 — owner input

- The worker does not edit `docs/owner-decisions.md` (the coordinator owns it) and does not change the legal pages or `TERMS_VERSION` (Q2). The final message gives the privacy page sentence for the next legal batch: "The assistant keeps counts per sender (mails, answers, corrections, reply times) under a keyed hash, with no mail text, and deletes them 12 months after the last mail." and the matching Polish sentence.

## Done when

`bun run lint` passes on the docs checks the repo has (`capability-map.test.ts`, docs guard tests). Then the Proof command.
