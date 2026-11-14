# F107 stage 04 — Terms of service and DPA (pl, en)

Part of [`../plan.md`](../plan.md). Decisions P1–P3, P5, D2, D5–D7. Needs stage 03. Sources as stage 03, plus `docs/capabilities/tenancy-and-plans.md` and the EU standard contractual clauses for Art. 28 (E07 notes §3, W13).

## Step 1 — Terms of service

**Goal.** `apps/web/src/legal/<pl|en>/terms.md` describe the service as it runs: one private install, members by invite, no payment.

**Sections (`##`; pl heading in brackets).**
1. The service (Usługa) — what it does (sort, summarize, delegate, filter spam, drafts on approval); it runs on a private server for its owner only (same fact as the draft line).
2. Accounts (Konta) — invite only; the setup link works once; password rules; optional TOTP; the operator; sessions and sign-out everywhere.
3. Plan state (Stan planu) — `trial`, `active`, `suspended` and what a suspended organization can still do (read, accept terms, delete); no prices, no payment terms.
4. Your mailbox (Twoja skrzynka) — the mailbox password is stored encrypted; use an app password; modes `shadow` and `assist`; the system never sends without the member's tap; it never deletes mail in the mailbox; drafts and folders it made stay after a delete (PD-039).
5. AI output (Wyniki AI) — can be wrong; the member checks each draft before sending; Undo for every automatic move.
6. Availability (Dostępność) — no service level; backups once a day; the panel only on the tailnet.
7. End and deletion (Zakończenie i usunięcie) — delete and export (the same facts as privacy section 7).
8. Liability and law (Odpowiedzialność i prawo) — `<to confirm: liability>`, `<to confirm: governing law>`.
9. Changes (Zmiany) — the version line and the dialog.

## Step 2 — Data processing agreement

**Goal.** `apps/web/src/legal/<pl|en>/dpa.md` hold the Art. 28(3) points for the mail that the organization (controller) gives to `<provider name>` (processor).

**Sections (`##`; pl heading in brackets).**
1. Parties and subject (Strony i przedmiot) — placeholders for both parties; the subject is the mail processing of the service; the duration is the life of the organization.
2. Nature and purpose (Charakter i cel) — triage, actions, drafts, digests, delegation follow-up.
3. Data and data subjects (Dane i osoby) — points to the data categories of the privacy policy (link to `/legal/<lang>/privacy`); subjects: members, senders and recipients of the mail.
4. Instructions (Polecenia) — the processor acts only on documented instructions: the settings in the panel and written requests of the owner.
5. Confidentiality (Poufność) — only the operator has access; `<to confirm: staff>`.
6. Security measures (Środki bezpieczeństwa) — Annex 1 inside the text: the measures of privacy section 8, written as a list.
7. Sub-processors (Podprocesorzy) — Annex 2 is the generated table (D2); a new sub-processor changes the version, and each member sees the dialog before it applies (the general written authorisation with notice).
8. Help with requests (Pomoc przy żądaniach) — the processor tells the controller of a request from a data subject and does not answer it itself (W13); find and erase on instruction; one month.
9. Breaches (Naruszenia) — the processor tells the controller without undue delay; the procedure is in `docs/legal/breach-procedure.md` (stage 05; name it, no link, the page is public and the repo path is not a URL).
10. End (Zakończenie) — at the end, the organization delete removes the data; the export on request first; backups expire by their rule.
11. Audits (Audyty) — `<to confirm: audit rights>`.

**Decisions.**
- The DPA uses "controller" and "processor" (pl: "administrator", "podmiot przetwarzający") and never "customer" for the controller.
- Plain language; the Polish text has the same content.

**Test.**
1. A unit test lists the nine terms headings and the eleven DPA headings of each language in the order above (exact text).
2. The en and pl DPA sources hold `<provider name>`; the terms sources hold `<to confirm: liability>` and `<to confirm: governing law>`.
3. (e2e) `legal.spec.ts` of stage 02 passes unchanged: run it under the lock (the Proof of stage 02).
4. The text guard passes after the bump (D5).

**Check.** The unit tests of `apps/web/src/lib/`, `bun run web:build`, the e2e spec `legal.spec.ts` under the lock.

**Done when.** Tests 1–4 pass and the Proof with the e2e step of stage 02 prints `PROOF_OK`. The final message lists statements with a weak source.

**Out of scope.** Privacy text changes (a found error is a question), internal papers (05), the claims list (06).
