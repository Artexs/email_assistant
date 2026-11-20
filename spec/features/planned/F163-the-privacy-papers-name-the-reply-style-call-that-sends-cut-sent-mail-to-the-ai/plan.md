# F163 plan — the papers name the reply-style call

> **Status 2026-11-20 — planned.** Plan base: 86e3469dd. Two stages; no migration, no `bun.lock`.

## Input

Coordinator task 2026-11-20: "Use the F162 plan and its landed stages as the model: the same papers (privacy page, DPA, terms, DPIA, ledger, public claim, code-tie test apps/server/src/legal-outside-calls.test.ts). The reply-style call is apps/server/src/modules/replies/stylist.ts; read it for exactly what it sends (cut text of own Sent mail), limits, retries and flag style_from_sent (off). Legal version 2026-11-20.2 is unreleased, so the new text can ride it."

F162 outcome: "Not covered: the reply-style call sends cut Sent mail to the AI and no paper names it (follow-up ticket)."

### Decisions

- **P1 One re-acceptance, a new appended entry.** Stage 01 appends one `TERMS_HISTORY` entry from `nextLegalVersion` (expected `2026-11-20.3`). Entry `2026-11-20.2` is in no release tag (newest tag v0.4.4 ends at `2026-11-20`), so both ship on the same release and each member accepts once. Rejected: a new digest for `.2` (it breaks the append-only rule of `docs/capabilities/papers.md` rule 5, and a build between tags can hold acceptance rows for the old `.2` text). Default, owner to confirm.
- **P2 No behaviour or flag change** (ticket). `style_from_sent` stays off.
- **P3 The style call** (privacy "AI model", after the open-loops part). With the style suggestion on (optional, off by default), when an owner taps "Suggest my style from my sent mail", the assistant sends the text of up to 100 own sent mails of that mailbox from the last 14 days: at most 1,500 characters of each and 60,000 characters in all. It first cuts off the quoted older mail, the forwarded part and the signature. No subject and no address goes. The text that the user wrote can still hold names and facts of other people. It needs the switch "Track my sent mail" on, and skips list, automatic and calendar mail and drafts of the system. At most three runs a day for each mailbox; each run makes at most two calls (the second only when the first answer could not be read or failed a check); a call that fails at the AI service is not tried again. The AI answers with a description of how the user writes (at most 1,000 characters). The server does not store it; the owner can edit it and save it as the writing style of the mailbox. Rejected: the prompt version, the flag key, the 5-sample minimum.
- **P4 "AI results" and "AI and decisions"** (privacy) each add one sentence: the AI can describe how the user writes from own sent mail, on an owner's tap; nothing is stored until an owner saves it.
- **P5 Purpose: inside "Drafts".** The style serves reply drafts. Privacy "Why and on what basis" Drafts bullet, DPA "Nature and purpose" Drafts line, DPIA Purposes and record B Purposes add "and, on an owner's tap, a suggested writing style from own sent mail". No new legal-basis placeholder. Rejected: a new purpose "Writing style" (a third `\<to confirm>` for the same basis). Default, owner to confirm.
- **P6 Registries.** `openai` and `gemini`: `purpose` adds "suggests a writing style from own sent mail"; `dataReceived` adds "for a style suggestion: the text of up to 100 own sent mails of the last 14 days, with quoted mail and signature cut off, at most 1,500 characters each and 60,000 in all, no subject or address" (Polish: same facts, D3 forms). `gemini` `dataReceived` also gets the reply-draft fields that `openai` has (display name, signature, writing style, instruction line, time zone): today the row omits them (default, owner to confirm). `mailbox-profile` `purpose` adds "or a style suggestion from your sent mail that an owner saved".
- **P7 The public claim stays.** `ai-provider-receives` names no reply-draft call today; the style call needs `reply_drafts`. A follow-up ticket names both reply-draft calls in the claim and the DPIA flow before `reply_drafts` goes on outside the pilot. Default, owner to confirm.
- **P8 In-panel texts stay.** `sent_line` and `tg_consent_text` stay; the button label names sent mail at the tap. Terms: no change (no sentence there lists AI inputs).
- **P9 DPIA and record B.** DPIA Flow gets the P3 sentence group; "Is the data needed?" gets one bullet (P3 limits, the cut, the name check on the answer, no store); R1 text and R1 measures name the style call; no new risk (R1 covers mail text to the provider). Record B Purposes per P5. Rejected: risk R11.
- **P10 Retention and DSR: no change.** The call stores no text: the `llm.call` audit rows and `mailbox.style_suggested` hold codes and counts. A saved style is the existing `mailbox-profile` category.
- **D1 Ledger.** New section rows after C270: C271 the style call input (P3 fields and cut; sources `packages/core/src/replies/style-samples.ts`, `apps/server/src/modules/mail/repo/style-sources.ts`, `apps/server/src/modules/triage/prompts/stylist-v1.ts`), C272 when and how often (owner tap, flags, switch, 3 runs, 2 calls, no retry after a provider error, no store; sources `apps/server/src/modules/replies/style-suggest.ts`, `apps/server/src/modules/replies/stylist.ts`, `docs/capabilities/reply-drafts.md` rule 17), C273 the DPIA and record B text (stage 02). Changed: C136, C139, the `mailbox-profile` row, each Drafts purpose row, the AI results and AI and decisions rows. The pin in `apps/docs/src/security/claims.test.ts` follows (270 → 272 in stage 01, → 273 in stage 02). If master took the ids, use the next free ones everywhere.
- **D2 Code ties** in `apps/server/src/legal-outside-calls.test.ts`, a new `describe("style suggestion")`. Constants through the public indexes (`@ea/core`, `./modules/replies`, `./modules/triage`).
- **D3 Number strings come from the constants.** English `toLocaleString("en-US")` (`1,500 characters`, `60,000 characters`, `1,000 characters`), Polish the plain number (`1500 znaków`, `60000 znaków`); `14 days` / `14 dni` from `STYLE_SUGGEST_WINDOW_MS / DAY_MS`; `100` from `STYLE_MAX_SOURCES`.
- **D4 The version entry.** The first commit that changes a digest input appends the P1 entry (the pre-commit hook runs `legal-version.test.ts`); each later commit of stage 01 re-digests that same unlanded entry. After `git merge master`, when master gained a newer entry, move this one after it with a fresh version. Never edit a landed entry.
- **D5 No 7-day wording** in new text.

## Facts checked (2026-11-20, at 86e3469dd)

- `buildStyleSamples` (`@ea/core`): `cutQuotedReply`, then `STYLE_SAMPLE_MAX_CHARS` 1500 per text, `STYLE_SAMPLES_MAX_CHARS` 60000 in all; returns `samples` and `names` (names feed only the answer check). Probe: one source with a quoted part and a To address gave `{"samples":["Hi team,\nThe offer is attached."],"names":["anna","nowak"]}`.
- `listStyleSources` reads only `body_text`, `to_addresses`, `cc_addresses` of `sent_emails` (origin user, stored, no auto, list, bulk or calendar mail, no system draft), newest first, `STYLE_MAX_SOURCES` 100.
- `style-suggest.ts`: `STYLE_SUGGEST_WINDOW_MS` 14 days, `STYLE_SUGGEST_DAILY_LIMIT` 3, `realMail` false gives `llm_off` before any read. `stylist.ts`: `STYLIST_MAX_CALLS` 2, retry only after `LlmOutputError` or a failed check; any other LLM error throws `StylistCallError` (no retry). SDK `maxRetries: 0` (openai).
- `prompts.stylist`: version `stylist-v1`, role `stylist`. `STYLE_SUGGESTION_MAX_CHARS` 1000. Flag `style_from_sent` default off, epic E6b.
- `TERMS_HISTORY` ends at `2026-11-20.2`; `git show v0.4.4:packages/core/src/web/terms.ts` has no `.2`. Ledger: 270 rows. The `gemini` row has no reply-draft fields.

## Not verified

- Whether another branch takes C271+ or a legal version first: stage 01 checks after `git merge master` (D1, D4).

## Done when

The ticket Acceptance; each stage's Proof exits 0.

## Rules for every stage

- Plain technical English; the Polish text says the same facts. No new claim without a ledger row. No real host, name or address (public repository).
- Never `bun run format` repo-wide; format only the stage's files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f163 && bun test apps/web/src/lib packages/core/src/legal packages/core/src/web apps/server/src/legal-papers.test.ts apps/server/src/legal-retention.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/trust-docs.test.ts apps/docs/src apps/docs/integrations > /tmp/f163/legal.log 2>&1 && bun run docs:build > /tmp/f163/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f163/docs.log && bun run check:job`

## User checkpoints and user steps

- Stage 01 appends a legal version: on the release after v0.4.4 each member accepts once (with `.2`); name it in the release notes. No owner stop.
- Record, not a stage: `style_from_sent` goes on only on a release that carries stage 01.

## Review

Stage 01 `[risky]` (privacy text, new Polish user text): one review job with `claude-opus-5-5` before the land. Stage 02 lands on the proof.

## Stages

- [ ] 01 `[risky]` in-app texts, registries, legal version, ledger rows — [stage-01](stages/stage-01-privacy-and-version.md)
- [ ] 02 code ties, DPIA, record B, capability pages — [stage-02](stages/stage-02-ties-and-dpia.md)

## How to run (coordinator)

01, then 02. One job per stage (board worker model, `--prepare 'bash scripts/limen-prepare.sh'`). `questions.md` lists the defaults.

## Planning progress

- Scouts: 3 (`scouts.md`). Stages 01–02 [written]. Words: plan 1419; stages 655, 698.

## Cold review

Planned: one round, `claude-opus-5-5` (stage 01 `[risky]`, privacy text and new Polish user text: a TRACK risk area).

## Log

- 2026-11-20 plan at `86e3469dd`.
