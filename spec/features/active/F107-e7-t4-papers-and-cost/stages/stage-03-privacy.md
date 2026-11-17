# F107 stage 03 — Privacy policy (pl, en)

Part of [`../plan.md`](../plan.md). Decisions P1–P3, D2, D5–D7, E2. Needs stage 02.

## Step 1 — Write the privacy policy

**Goal.** `apps/web/src/legal/en/privacy.md` and `pl/privacy.md` state what the system does with personal data at `HEAD`, for a member and for a sender who is not a member.

**Sources (open each; cite none from memory).** `docs/architecture.md` §5–§8; `docs/capabilities/` (retention, backups, account-data, web-panel, digest-and-notices, drafts-and-send, tenancy-and-plans); ADR 0008, 0009, 0011, 0012, 0015, 0017, 0026; `deploy/README.md` § Account data; the stage 01 registries; the consent text `tg_consent_text`; `notes/2026-11-12-s6a-customer-core.md` (kept ids).

**Sections (`##`, in this order; pl heading in brackets).**
1. Who is responsible (Kto odpowiada) — roles: the organization is the controller of its mail; `<provider name>` is its processor, and the controller of the account data of members. Contact `<contact>`, `<address>`.
2. What data (Jakie dane) — points to the generated data-category table (D2); names the kept technical ids (Message-ID, dedup and thread keys, content hash) and that rows stay for counts after the text is cleared.
3. Why and on what basis (Cel i podstawa) — triage, actions, drafts on approval, digests, delegation follow-up, security (lockout, audit), measurement; the legal basis per purpose as `<to confirm: legal basis>` unless a source states it.
4. How long (Jak długo) — points to the table; the daily retention job; backups keep rows until they expire (`<backup retention>` if the bucket rule is not in a source).
5. Who receives data (Kto otrzymuje dane) — points to the generated sub-processor table; "this install uses OpenAI" (E2); OpenAI: no training on API data, `store: false`, abuse logs up to 30 days (ADR 0015); transfers outside the EEA (OpenAI, Telegram) with `<to confirm: transfer mechanism>`; Telegram gets only what the consent text says, after the member's consent.
6. AI and decisions (AI i decyzje) — the AI sorts and drafts; it never sends a mail; a send needs a tap on the exact text; every automatic move has a reason and Undo; no decision with legal effect.
7. Your rights (Twoje prawa) — members: access and export (the operator runs `org:export` on request), deletion (Account card when the operator turned it on, else `org:delete` on request), correction, objection; senders who are not members: ask the organization; the processor acts on its instruction (find, erase, tombstones that stop re-import); one month (Art. 12(3)); complaint to the supervisory authority (UODO in Poland).
8. Security (Bezpieczeństwo) — encrypted mailbox secrets, TLS with certificate checks, the panel only through Tailscale, encrypted backups, lockout, leaked-password check, optional TOTP, tenant isolation, logs without mail text; advise an app password.
9. Changes (Zmiany) — the version line; a new version shows a dialog that each member accepts.

**Decisions.**
- Plain language, short sentences; the Polish text is a natural Polish text with the same content, not a word-for-word copy.
- Each statement must be true at `HEAD` and traceable; stage 06 lists the sources. Note in the final message each statement whose source was weak.
- Do not describe planned features (read Sent, OAuth, push, sender profiles, the EU endpoint).

**Test.**
1. A unit test lists the nine `##` headings of each language in the order above (exact text).
2. The en and pl privacy sources hold `<provider name>` and `<contact>` (P3).
3. Every placeholder is in `legalPlaceholders` (extend the list for new ones such as `<backup retention>`; each new entry is named in the final message).
4. The placeholder and parity checks of stage 02 pass; `TERMS_VERSION` stays (D5: stage 06 bumps it).

**Check.** The unit tests of `apps/web/src/lib/`, `bun run web:build`.

**Done when.** Tests 1–4 pass and the Proof prints `PROOF_OK`. The final message lists the statements with a weak source.

**Out of scope.** Terms and DPA (04), internal papers (05), the claims list (06), changes to registry rows (a wrong row goes to the final message; stage 06 fixes it).
