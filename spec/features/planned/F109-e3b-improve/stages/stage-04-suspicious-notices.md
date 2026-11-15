# F109 stage 04 — Warning in notices, and the reader for other tickets

Part of [`../plan.md`](../plan.md). Decisions P1, D5, D6. Needs stage 03.

## Step 1 — `suspiciousReasonsOf`

**Goal.** One reader that E5b (follow-ups), E6a (reply drafts) and E4-B (unsubscribe) call before they draft or act.

**Files.** New `apps/server/src/modules/triage/suspicious-repo.ts`, exported through the triage module's public entry (module borders, F086).

**Interface (other tickets use it; keep it).** `suspiciousReasonsOf(db, ctx, emailIds: string[]): Promise<Map<string, SuspiciousReason[]>>` — the reasons of the newest `triage_results` row of each mail; a mail with no row or `{}` is absent from the map. It ignores the flag: callers that block a draft block it with the flag off too (P1 is a safety rule; only the warning text is a flagged UI change).

**Test.** 1. Two rows for one mail, newest `{link_mismatch}` → that list. 2. A mail of org B is absent for org A. 3. Empty input → empty map, no query.

## Step 2 — Warning line in Telegram notices

**Goal.** The urgent notice and the daily digest row show the warning.

**Decisions.**

- Notices are facts (F088): the urgent notice view and the digest item get `suspicious: SuspiciousReason[]`, filled at queue or build time only when the flag `suspicious_mail` is on for the organization, else `[]`. The renderer prints one line when the list is not empty, after the reason line.
- Texts (in the core texts, both languages; the order of `suspiciousReasons`, joined by `, `):
  - en: line `⚠ Suspicious: <list>`; codes `sender check failed`, `look-alike domain`, `fake sender name`, `replies go to another domain`, `link goes elsewhere`, `risky attachment`.
  - pl: line `⚠ Podejrzana wiadomość: <list>`; codes `nadawca nie przeszedł weryfikacji`, `domena podobna do znanej`, `fałszywa nazwa nadawcy`, `odpowiedzi idą do innej domeny`, `link prowadzi gdzie indziej`, `ryzykowny załącznik`.
- A flagged `delegation` mail (stage 03 planned nothing) shows `no draft: suspicious mail` / `bez szkicu: podejrzana wiadomość` in place of the "would do" line.
- Old notice facts without the field render as before (the field is optional on read).

**Test.**

4. Render an urgent view with `["lookalike_domain","risky_attachment"]`, en → the line `⚠ Suspicious: look-alike domain, risky attachment`; pl → the Polish line.
5. An old view without `suspicious` → the output of today, byte for byte.
6. Integration: flag on, a flagged urgent mail → the queued urgent view holds the codes; flag off → `[]`.
7. Digest with a flagged `delegation` item → the `no draft` line, no draft line.

## Step 3 — Activity API and panel row

**Goal.** The panel's activity row shows the same warning.

**Decisions.** The activity item of the API gets `suspicious: SuspiciousReason[]` (same flag rule); the web activity row prints the warning with i18n keys for the six codes (texts as in step 2). Add the field to the API schema in `packages/core/src/web/`.

**Test.** 8. The activity route returns the codes for a flagged mail with the flag on, `[]` with it off. 9. The view helper of the activity row returns the en and pl line for test 4's codes.

**Check.** The changed unit and integration tests, then the Proof.

**Done when.** Tests 1–9 pass; Proof `PROOF_OK`.

**Out of scope.** Attachment line (stage 06), any draft kind other than delegation, unsubscribe (E4-B).
