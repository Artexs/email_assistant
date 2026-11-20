# F163 plan — the papers name the reply-style call

> **Status 2026-11-20 — planned.** Plan base: 86e3469dd. Two stages; no migration, no `bun.lock`.

## Input

Coordinator task 2026-11-20: "Use the F162 plan and its landed stages as the model [...]. The reply-style call is apps/server/src/modules/replies/stylist.ts; read it for exactly what it sends (cut text of own Sent mail), limits, retries and flag style_from_sent (off). Legal version 2026-11-20.2 is unreleased, so the new text can ride it."

### Decisions

- **P1 One re-acceptance, a new appended entry.** Stage 01 appends one `TERMS_HISTORY` entry from `nextLegalVersion` (the build day). `2026-11-20.2` is in no release tag; acceptance compares only the last version, so both ship on one release and each member accepts once. Rejected: a new digest for `.2` (breaks the append-only rule, `docs/capabilities/papers.md` rule 5). Default, owner to confirm.
- **P2 No behaviour or flag change** (ticket).
- **P3 The style call** (privacy "AI model", after the open-loops part, before the Gemini sentence). With the style suggestion on (optional, off by default), only when an owner taps "Suggest my style from my sent mail" (the `rs_suggest_button` text of the page language), the assistant sends the text of up to 100 own sent mails of that mailbox from the last 14 days: at most 1,500 characters of each and 60,000 characters in all. It tries to cut off the quoted older mail, the forwarded part and the mailbox signature first. No subject and no address from the headers goes. The text can still hold names, addresses and quoted mail of other people. It needs the switch "Track my sent mail" on, and skips list, automatic and calendar mail and drafts of the system. Each tap makes at most two calls with the same texts (the second only when the first answer could not be read or failed a check); a call that fails at the AI service is not tried again. The AI answers with a description of how the user writes (at most 1,000 characters). The server does not store it; the owner can edit and save it as the mailbox writing style. Rejected in the page: the daily run limit (not absolute; C272 states its rule), the prompt version, the flag key.
- **P4 "AI results" and "AI and decisions"** (privacy) each add one sentence: the AI can describe how the user writes from own sent mail, on an owner's tap; nothing is stored until an owner saves it.
- **P5 Purpose: inside "Drafts".** The style serves reply drafts. The privacy, DPA, DPIA and record B Drafts purposes add "and, on an owner's tap, a suggested writing style from own sent mail". No new legal-basis placeholder. Rejected: a new purpose "Writing style" (a third `\<to confirm>` for the same basis). Default, owner to confirm.
- **P6 Registries.** `openai` and `gemini`: `purpose` adds "suggests a writing style from own sent mail"; `dataReceived` adds "for a style suggestion: the text of up to 100 own sent mails of the last 14 days, at most 1,500 characters each and 60,000 characters in all, with no subject or header address; quoted mail and the signature are cut off where the code finds them" (Polish: same facts, D3 forms). `gemini` `dataReceived` also gets the reply-draft fields that `openai` has (today it omits them; default, owner to confirm). `mailbox-profile` `purpose` adds "or a style suggestion from your sent mail that an owner saved".
- **P7 The public claim stays.** `ai-provider-receives` names no reply-draft call today; the style call needs `reply_drafts`. A follow-up ticket names both reply-draft calls in the claim and the DPIA flow, before `style_from_sent` goes on for anyone. Default, owner to confirm.
- **P8 In-panel texts.** `sent_line` and `tg_consent_text` stay. `rs_suggest_note` (en, pl; no legal digest input) says "once" / "Jednorazowo", but a retry sends the same texts a second time: stage 02 changes it to "in at most two calls" (pl the same fact). The terms page: no change (no sentence there lists AI inputs).
- **P9 DPIA and record B.** DPIA Flow and one "Is the data needed?" bullet say P3 (bullet detail in the stage 02 file); R1 and its measures name the style call; no new risk (R1 covers mail text to the provider). Record B Purposes per P5. Rejected: risk R11.
- **P10 Retention and DSR: no change.** The call stores no text (the audit rows hold codes and counts); a saved style is the `mailbox-profile` category.
- **D1 Ledger.** New rows after C270: C271 the style call input, C272 when and how often (sources in the stage 01 file), C273 the DPIA and record B text (stage 02). Changed: C136, C139, the `mailbox-profile` row, each Drafts purpose row, the AI results and AI and decisions rows. The pin in `apps/docs/src/security/claims.test.ts` follows (270 → 272 → 273). If master took the ids, use the next free ones everywhere.
- **D2 Code ties** in `apps/server/src/legal-outside-calls.test.ts`, a new `describe("style suggestion")`. Stage 01 writes the ties of the digest inputs (pins, the page, registry and ledger strings), so a wrong string fails before the version lands; stage 02 adds the DPIA ties. The ties pin the constants, not their use sites (the F162 method). Constants through the public indexes.
- **D3 Number strings come from the constants.** English `toLocaleString("en-US")` (`1,500 characters`), Polish the plain number (`1500 znaków`); `14 days` / `14 dni` from `STYLE_SUGGEST_WINDOW_MS / DAY_MS`.
- **D4 The version entry.** The first commit that changes a digest input appends the P1 entry; later commits of stage 01 re-digest that unlanded entry. When master gains a newer entry, move this one after it with a fresh version. Never edit a landed entry.
- **D5 No 7-day wording.**

## Facts checked (2026-11-20, at 86e3469dd; review 1 confirmed each at a9155588e)

- `buildStyleSamples`: the cut, then 1500 per text, 60000 in all; `names` feed only the answer check. Probe: the stage 01 case 2 input gives `{"samples":["Hi team,\nThe offer is attached."],"names":["anna","nowak"]}`.
- The cut finds only fixed English and Polish quote headers, Outlook blocks of 2+ header lines, the stored or fallback signature and a `--` line; the review probe kept a German quote, a one-line `From:` quote, a body address and an unknown signature.
- `listStyleSources` reads only `body_text`, `to_addresses`, `cc_addresses`, with the P3 filters, newest first, at most 100.
- Window 14 days, limit 3 (a run that ends `sent_off` after the call does not count; the busy lock is per process), `realMail` false gives `llm_off` before any read; 2 calls, retry only after an unreadable answer or a failed check; no SDK retry (openai `maxRetries: 0`; Gemini sets no retry options).
- `prompts.stylist`: `stylist-v1`, role `stylist`; answer cap 1000; `style_from_sent` default off.
- Each VPS deploy is a tag release (`spec/build.md` TRACK). `TERMS_HISTORY` ends at `2026-11-20.2`, which v0.4.4 lacks; acceptance compares only the last version. Ledger: 270 rows. The `gemini` row has no reply-draft fields.

## Not verified

- Whether another branch takes C271+ or a version first: stage 01 checks after `git merge master`.

## Done when

The ticket Acceptance; each stage's Proof exits 0.

## Rules for every stage

- Plain technical English; the Polish text says the same facts. No new claim without a ledger row. No real host, name or address (public repository).
- Never `bun run format` repo-wide; format only the stage's files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f163 && bun test apps/web/src/lib packages/core/src/legal packages/core/src/web apps/server/src/legal-papers.test.ts apps/server/src/legal-retention.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/trust-docs.test.ts apps/docs/src apps/docs/integrations > /tmp/f163/legal.log 2>&1 && bun run docs:build > /tmp/f163/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f163/docs.log && bun run check:job`

## User checkpoints and user steps

- Stage 01 appends a legal version: the release after v0.4.4 asks each member once (with `.2`); name it in the release notes.
- Record, not a stage: `style_from_sent` goes on only on a release that carries stage 01.

## Review

Stage 01 `[risky]` (privacy text, new Polish user text): a `claude-opus-5-5` review before the land. Stage 02 lands on the proof.

## Stages

- [ ] 01 `[risky]` in-app texts, registries, legal version, ledger rows, their ties — [stage-01](stages/stage-01-privacy-and-version.md)
- [ ] 02 DPIA, record B, their ties, panel note, capability pages — [stage-02](stages/stage-02-ties-and-dpia.md)

## How to run (coordinator)

01, then 02. One job per stage (board worker model, `--prepare 'bash scripts/limen-prepare.sh'`). `questions.md` lists the defaults.

## Planning progress

- Scouts: 3 (`scouts.md`). Stages 01–02 [written]. Words: plan 1496; stages 684, 553.

## Cold review

One round, `claude-opus-5-5` (stage 01 `[risky]`, privacy and new Polish text), job `2026-11-20-f163-plan-review-48abf45f`: FAIL, 2 blocking, 8 notes (`plan-review-1.md`). Fixed B1 (P3, P6, C271, DPIA bullet), B2 (P6 strings; the digest ties moved to stage 01), N1 (P8 panel note), N2 (no run limit in the page), N3, N5, N7 (P1). Rejected N4 (use-site ties: the F162 method; a use-site change is style code, out of scope). N6 stays question 5; N8 needs nothing.


## Log

- 2026-11-20 plan at `86e3469dd`; review 1 fixes.
