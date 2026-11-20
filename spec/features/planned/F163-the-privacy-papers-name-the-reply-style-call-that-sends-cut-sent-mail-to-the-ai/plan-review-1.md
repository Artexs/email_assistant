# F163 plan review 1

Job `2026-11-20-f163-plan-review-48abf45f`, `claude-opus-5-5`, thinking high, at `a9155588e`. Final message, filed whole:

FAIL a9155588e10475dfbdafa44d16c850da89f06720

I reviewed the F163 plan (`spec/features/planned/F163-the-privacy-papers-name-the-reply-style-call-that-sends-cut-sent-mail-to-the-ai/`) at HEAD `a9155588`. HEAD matches the candidate. It is one commit after the plan base `86e3469dd`, and that commit is the plan itself, so the code facts still apply. Blocking here means one of two things. Either the plan, followed as written, ships a false privacy statement against ticket Acceptance line 1. Or it makes a later stage fail Acceptance line 4 (`check:job`).

## BLOCKING

**B1. P3 and P6 state the cut and "no address" as absolutes. The code does not do that. (Proven: code read and a probe.)**
- The plan text:
  - `plan.md:15` (P3): "It first cuts off the quoted older mail, the forwarded part and the signature. No subject and no address goes."
  - `plan.md:18` (P6): "with quoted mail and signature cut off … no subject or address".
  - The stage 01 row C271 (`stages/stage-01-privacy-and-version.md:25`) and the stage 02 DPIA bullet (`stage-02:10-11`) copy the same text.
- The code facts:
  - `packages/core/src/replies/style-cut.ts:4-17` finds a quote only from fixed English and Polish header patterns.
  - `style-cut.ts:19` and `:44-46` find an Outlook header block only when it has 2 or more header lines.
  - `style-cut.ts:72` and `:80-82` cut only the stored or fallback signature, or the text after a `--` line.
  - `neutralize` (`classifier-v2.ts:70-74`) removes only `<<<` and `>>>`.
  - The prompt itself says the sample "can hold text quoted from third parties" (`apps/server/src/modules/triage/prompts/stylist-v1.ts:29`).
- The probe (a /tmp script that imports `cutQuotedReply`) kept each of these whole:
  - a German "Am … schrieb Anna Nowak <anna@example.com>:" quote;
  - a one-line "From: Anna Nowak <anna@example.com>" quote;
  - an address in the body text;
  - a signature block that is not the stored one (name, title, phone).
- So addresses, phone numbers and quoted mail of other people can go to the provider. P3 warns only that "the text that the user wrote can still hold names and facts of other people".
- The F162 open-loops sentence is more precise (`apps/web/src/legal/en/privacy.md:48`): "No address from the headers goes … it can hold names, addresses and quoted mail of other people."
- The stage that lets it through: stage 01, the only stage with a review.
- Fix: rewrite P3, P6, C271 and the DPIA bullet:
  - "it tries to cut off the quoted older mail, the forwarded part and the mailbox signature";
  - "no subject and no address from the headers";
  - "the text can still hold names, addresses and quoted mail of other people".

**B2. The P6 text conflicts with D3 and with the stage 02 ties. Stage 02 then cannot pass without an edit to a digest input. (Proven: string comparison.)**
- `plan.md:18` (P6) prescribes the `dataReceived` en text "at most 1,500 characters each and 60,000 in all".
- Stage 02 case 5 (`stage-02-ties-and-dpia.md:31`) requires the en `dataReceived` to hold the en total-cap string `60,000 characters` (D3, `plan.md:25`). "60,000 in all" does not hold it.
- The same conflict hits C271: `stage-01:25` gives "1,500 characters each, 60,000 in all", and case 4 (`stage-02:30`) needs `60,000 characters`.
- A worker who copies P6 lands stage 01 green. Stage 01 has no style tie (`stage-01:38`: "The style ties are stage 02").
- Stage 02 then fails case 5. The fix is in `subprocessors.ts`, which feeds the legal digest. But stage 02 puts the version out of scope (`stage-02:15`), and D4 forbids an edit to a landed entry (`plan.md:26`).
- The result is a stop with a question, or a second appended version. If a release goes out between the two stages, members accept the terms twice. No rule in the plan prevents that release, and CLAUDE.md gives the coordinator standing release approval.
- Fix: write P6 and C271 with the D3 strings ("at most 1,500 characters each and 60,000 characters in all"). Also move stage 02 cases 3–5 (the ties on the privacy page, the ledger rows and the registries) into stage 01. The stage that changes the digest inputs then proves them before it lands.

## Unverified

- Whether the VPS ever runs an untagged build, which would make the tag-only release check in `stage-01:17` miss an acceptance of `2026-11-20.2`. P1 (`plan.md:13`) admits "a build between tags can hold acceptance rows". I did not check the deploy path.
- The Polish wording quality. No Polish text exists yet; the stage 01 worker writes it.

## Facts checked against the code

These match the code unless I say otherwise:

- **Text cut and caps:** `buildStyleSamples` applies the cut, then `STYLE_SAMPLE_MAX_CHARS` 1500 and `STYLE_SAMPLES_MAX_CHARS` = 40×1500 = 60000. It returns `samples` and `names` (`style-samples.ts:12-13,94-111`). Addresses feed only the name check (`style-samples.ts:5`).
- **Mail selection:** `listStyleSources` selects `body_text`, `to_addresses`, `cc_addresses` only. Filters: `origin` user, `content` stored, inside the window, not automatic, no list id, no bulk/list/junk precedence, no calendar mail, `action_id` null. It sorts newest first and stops at the limit (`style-sources.ts:20-38`). `STYLE_MAX_SOURCES` 100 (`style-samples.ts:17`), passed at `style-suggest.ts:146`.
- **Run gates:** window 14 days (`style-suggest.ts:30`, used at `:145`); daily limit 3 (`:28`); `realMail` false gives `llm_off` before any read (`:105-108`); `sent_sync` plus the mailbox switch (`:201-204`).
- **Calls and retry:** `STYLIST_MAX_CALLS` 2 (`stylist.ts:36,60`). A retry follows only `LlmOutputError`, a failed check, or a failed `checkProfileInput` (`stylist.ts:86-103`). Any other LLM error throws `StylistCallError` and gives no retry (`:101`).
- **No SDK retries:** OpenAI has `maxRetries: 0` (`openai.ts:126`). The Gemini SDK 2.32.0 retries only when `httpOptions.retryOptions` is set (`@google/genai` `apiCall`, the `if (!retryOptions)` branch), and `gemini.ts:92` sets only `baseUrl`. So "not tried again" also holds for Gemini.
- **Answer size:** `STYLE_SUGGESTION_MAX_CHARS` 1000 (`style-check.ts:8`). The schema accepts up to 4000 (`:9,39`), and the check refuses anything over 1000 (`:103`).
- **Prompt:** version `stylist-v1` (`stylist-v1.ts:7`). The user prompt sends only the language, the sample count, the samples, and the failure codes on a retry (`:94-107`).
- **Legal version:** `TERMS_HISTORY` ends at `2026-11-20.2` (`terms.ts:23`), and v0.4.4 ends at `2026-11-20`. Acceptance compares against the latest `TERMS_VERSION` only (`tenancy/routes.ts:104,170`), so two unreleased entries still mean one re-acceptance.
- **Ledger:** 270 rows, pinned at `apps/docs/src/security/claims.test.ts:125`.
- **Button label:** `rs_suggest_button` exists in en and pl (`texts/en-reply.ts:56`, `texts/pl-reply.ts:60`).
- **Stage 02 slice anchors:** both Gemini anchor sentences exist (`privacy.md:48` en and pl).
- **Stage 02 case 2 fixture:** "On Mon, 16 Nov 2026, Anna Nowak wrote:" matches `EN_WROTE_START`/`END` (`style-cut.ts:5-6`), so the expected `samples` value is right.

## Pre-mortem: which stage let the bug through

- **A false or incomplete privacy text:** stage 01. B1 comes from the P3 text. N1 is the in-panel note that P8 does not cover. Stage 01 lands with no style tie, so only its review can catch a text error.
- **A second terms re-acceptance:** the split between stage 01 and stage 02, together with B2. The registry edit can come only after stage 01 has landed, and no rule stops a release between the stages.
- **A tie test that passes when a limit changes:** case 1 pins every named constant, so a change to a constant fails. The remaining gaps are the places that use the constants (N4) and a wrong break-check list (N3).

## NOTES

- **N1, proven (code read): the in-panel note conflicts with P3, and P8 says nothing about it.**
  - `rs_suggest_note` (`texts/en-reply.ts:57-58`) says: "Sends up to 100 sent mails … to the AI provider, once." The pl text at `texts/pl-reply.ts:61-62` says "Jednorazowo".
  - A retry sends the same samples a second time (`stylist.ts:65-79`), and P3 says "at most two calls".
  - P8 (`plan.md:20`) reviews only `sent_line` and `tg_consent_text`.
  - The key is not a legal digest input, so a fix costs no version. Add a decision to P8.
- **N2, proven (code read): "at most three runs a day" can be exceeded.**
  - A run that called the model and then found the switch off records `sent_off` (`style-suggest.ts:186-188`). `sent_off` is not in `CALL_OUTCOMES` (`:33`), so that run does not count against the limit.
  - The `running` lock is held in memory in one process only (`:79,91-93`).
  - P3, C272 and the privacy text state the limit as an absolute. Either soften the text ("three runs that end with an answer or an error"), or open a code ticket that counts `sent_off` after a call.
- **N3, proven (arithmetic): the stage 02 break-check list is wrong.**
  - With `STYLE_SAMPLE_MAX_CHARS` set to 1499, `STYLE_SAMPLES_MAX_CHARS` becomes 59960 (`style-samples.ts:13`). Case 7 (C273 holds the total cap) then fails too.
  - `stage-02:34` lists only cases 1, 3, 4, 5, 6, and "failed as stated" (`stage-02:43`) then does not hold.
- **N4, plausible: the ties pin the constants, not the places that use them.**
  - `style-suggest.ts:145-146` could pass another window or limit, and every case would still pass.
  - `apps/server/test/integration/replies-style-suggest.test.ts` covers the daily limit (`:202`). I found no test of the 14-day window or the 100-mail cap at that use site.
  - Consider one tie on what the service passes to `listStyleSources`, or accept this as the F162 method.
- **N5, proven (code read): the planned DPIA bullet overstates the name check.**
  - `stage-02:11` says "the answer fails its check when it holds a name". `style-samples.ts:78` states the known limit: a name that the texts never show capitalised in mid-sentence passes.
  - Say "a name found in the samples or the recipient addresses".
- **N6, unverified: P7 leaves the public claim without the style call.**
  - The claim at `apps/docs/src/security/claims.ts:48` lists what the provider gets. It will leave out the style call once `style_from_sent` is on for the pilot.
  - P7 defers this until "before `reply_drafts` goes on outside the pilot". Confirm that the pilot readers of the public page accept an incomplete list.
- **N7, plausible: P1 names the wrong expected version string.**
  - P1 expects `2026-11-20.3`, but `nextLegalVersion` uses today's UTC date. A build on or after 2026-11-21 gives `2026-11-21`.
  - The Done-when check (`stage-01:43`) is still correct. Only the expected string and the release-note text in the ticket (`ticket.md:31`) can be wrong.
- **N8: the stage sizes are fine.** Stage 01 covers six text seams plus the ledger, which is about the size of an F162 stage. Stage 02 is smaller. Neither needs a split.

## Checks I ran

- `git rev-parse HEAD` gave `a9155588e10475dfbdafa44d16c850da89f06720`, which matches the candidate.
- `git log 86e3469dd..HEAD` showed 1 commit (the plan). `git diff --stat` from the plan base over the replies, core, legal and docs paths was empty.
- `git tag --sort=-creatordate` gave v0.4.4 as the newest tag. `git show v0.4.4:packages/core/src/web/terms.ts` has no `.2` entry.
- A probe script in /tmp ran `cutQuotedReply` on four inputs; the output is under B1. I removed it afterwards.
- I read `@google/genai` 2.32.0 in the main checkout's `node_modules` (read only) for the retry default.
- I ran no test suite, lint or typecheck (review job). `test -z "$(git status --short)" && git rev-parse HEAD` exited 0: the worktree is clean, and I committed nothing.

## Note check

- Facts checked against the four code files: proven. Each fact has a file and line in the "Facts checked against the code" section above (my own reads of `stylist.ts`, `style-suggest.ts`, `style-samples.ts` and `style-sources.ts` this session).
- Pre-mortem for the three bug classes: proven. The "Pre-mortem" section above names a stage for each class, with file and line.
- Findings sorted BLOCKING / NOTE, first line PASS or FAIL with the sha: proven. The first line of this message is `FAIL a9155588…`; B1–B2 are blocking and N1–N8 are notes.
- Easy-to-miss rule "Read-only: run no test suite; edit and commit nothing": followed. Evidence: `test -z "$(git status --short)" && git rev-parse HEAD` exited 0. I ran no suite, lint or typecheck, only one /tmp probe script, which I removed.
- Reminder, tests once per job and no suite runs: followed. I ran no `test:*` command.
- Reminder, `check:job` before the final message of a code job: not applicable. This review job commits no product code.
- Reminder, a review runs no suite, lint or typecheck: followed. One probe proved a specific doubt (B1).
- Reminder, never delete `node_modules/.cache`: followed. I touched no cache.
