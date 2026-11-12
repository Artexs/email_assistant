# E2 · Quality lab — discovery notes (2026-11-13)

> Detail for the "Discovery" section of `E02-quality-lab.md`. Written by the E2 discovery session (Opus 5.5). The next agent has no chat history: everything the decisions rest on is here.

## 1. What exists today (code cross-check, read 2026-11-13)

| Item of the epic | Exists today (file or module) | Partly there | New |
| --- | --- | --- | --- |
| Offline eval runner | `apps/server/src/modules/triage/eval.ts`, `eval-report.ts`, script `apps/server/src/scripts/eval.ts` (`bun run eval`): precision, recall, go/no-go, injection, whitelist, delegate pick, draft kind, usage and cost per mail, resume state in `evals/.runs/` | Runs cases one after another (`for (const c of input.cases)`, eval.ts:457). 1,300 cases at p50 1.4 s ≈ 30 min: needs a worker pool for the < 10 min exit | `--sim` set loader, per-language and per-source columns, Wilson lower bound, run budget cap |
| Eval cases | `evals/cases/` 108 cases (80 synthetic, 16 injection, 12 delegation); schema `packages/core/src/triage/eval-case.ts`; fixed time `EVAL_RECEIVED_AT` | One mail per case; thread context only in a few; no persona, no urgency source, no timestamps over days | Scenario format: company, personas with own addresses, urgency context, timeline, threads, attachments, HTML |
| Writer and blind checker | `evals/testmail/README.md` procedure; pi agents `~/.pi/agent/agents/testmail-writer.md` (Claude Sonnet 5.5) and `testmail-checker.md` (Claude Haiku 5.5); `packages/core/src/testmail/batch.ts` (`validateBatch`), `blind.ts` (`blindView`, `applyBlindLabels`) | Batch of 25, 5 categories, one shared sender | Scenario-level writer task ("label first, write second"), delegation and hard-case labels, per-persona addresses |
| Live sender | `apps/server/src/modules/testmail/` (AgentMail REST, 1.2k lines): one inbox `ea-testmail-75wd`, sends to the Interia **pilot** mailbox | Real delivery, but one sender address, 50 mails/day tool cap, and PD-006 forbids the pilot mailbox | GreenMail SMTP injector for the sim stack |
| Live scorer | `bun run testmail:remote compare` (`testmail/remote.ts`): joins batch ground truth with VPS triage rows, prints a table and a go/no-go report | Category only; `delegation` counts as WRONG (F065) | Week scorer: M1, M2 (delegations), M3 candidate events, M4, M5, M7 from DB and audit rows |
| APPEND seeder | `apps/server/src/modules/mail/seed.ts`, `bun run mailbox:seed` (eval cases into INBOX of `TEST_MAILBOX_ADDRESS` only, header `X-EA-Seed: 1`) | Refuses any mailbox except the test address | Not needed if the injector uses GreenMail SMTP |
| Local mail server | GreenMail 2.1.15 in `deploy/compose.dev.yaml` (dev only); notes `notes/2026-11-03-greenmail-facts.md` | Dev and integration tests only | GreenMail service in the sim stack |
| Fake Telegram | `tools/fake-telegram/` (Bot API fake + driver: presses inline buttons, reads chats) | Binds `127.0.0.1`; one process per run | Run it as a service of the sim stack; the scripted executive drives it |
| Real-label tools | `bun run triage:label` CLI, `eval --real` from `triage_feedback`; feedback sources `cli, telegram, undo, imap_move, web` | `/review` command not built (F028) | F028 |
| Test mail kept apart from real labels | ADR 0013 `synthetic` scope by Message-ID suffix | AgentMail mail on the pilot is not "synthetic" (F057) | F057 |
| Urgency context | Only the VIP flag of sender rules reaches the classifier (`SenderContext` in `apps/server/src/modules/triage/classifier.ts`) | VIP rules exist | Persona urgency profile in the scenario; product setting and prompt are E3/E4 |
| Draft quality scorer | Eval checks only draft kind and recipient safety (README "Delegates") | — | Draft judge: code checks + rubric by a second model family |
| Model-upgrade gate | Prompt files say "a new file and a passing `bun run eval`" (`prompts/classifier-v2.ts:5`) | A convention, not a check | Gate step in the release checklist and in prompt/model tickets |
| Clock | No clock abstraction: jobs read the system time (`sync.ts`, `expiry.ts`, `digest-job.ts`, …) | — | Not built: the live run uses real time (decision 10) |
| Demo organization | `org:create`, `mailbox:connect` CLIs; e2e seed (`apps/server/src/scripts/e2e-seed.ts`) | — | Demo org in the sim stack, reset command |
| Host guard | `apps/server/src/modules/mail/host-check.ts` refuses private and Tailscale ranges; `MAIL_ALLOW_LOCAL_HOSTS` (F082 s09) is one switch for the whole server | — | The sim stack sets it to `true`; production never does (ADR 0021 draft) |

Corrections to the epic page:
- "`testmail-checker` becomes the scorer" is wrong. `testmail-checker` is the blind labeler. The scorer is `testmail:remote compare`; the week scorer is new code next to it.
- "AgentMail persona inboxes" for delegates do not fit: Free plan = 3 inboxes (2 hold the owner's own inboxes), and AgentMail drops a `From` override. GreenMail hosts any number of persona addresses with no third party.
- "In CI with a budget": GitHub CI has no LLM key today (`.github/workflows/ci.yml`). Putting one there adds a secret to a third party for a check that a release step does as well (decision 13).

## 2. Design sketch the decisions rest on

### 2.1 Two corpora, both frozen in git

| Corpus | Purpose | Shape | Size |
| --- | --- | --- | --- |
| Category bank | Precision and recall per category; go/no-go; hard cases | Balanced; one mail per case with its thread context; personas and urgency profile of the scenario | 250 per value category (`urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam`): 50 **dev** (visible to prompt tuning) + 200 **holdout** (gate only). About 1,500 cases + the hard-case list |
| Realistic week | M1–M5, M7 at volume; live runs; demo | Timeline over 7 days, 150 mails per weekday, 40 per weekend day (≈ 830), threads over days, planned delegate behaviours | Mix (default): notification 35%, spam/marketing 20%, info 20%, needs_reply 13%, delegation 7%, urgent 5% |

Why 200 holdout per category: with 0 errors in n cases the 95% upper bound of the error rate is about 3/n ("rule of three"). The 98% bar (M8) needs n ≥ 150 to mean anything; 200 leaves room for one error. The real-label gate keeps n ≥ 30 because real labels are scarce, and the report says so.

Why a holdout: E3 tunes prompts on this lab. A set the tuning agent sees becomes a training set. The holdout ids live in a separate file; the plan-task tickets of E3 forbid opening it.

### 2.2 Label first, write second

1. A scenario file (agent-written once, validated by code): company, 12–18 personas with their own `*.test` addresses, groups, language, voice; the executive's urgency profile; delegates with tags; the storyline.
2. A planner (code, seeded) turns the storyline into case slots: persona, time, thread parent, category, urgency source, hard-case tags, expected delegate, expected draft, expected delegate behaviour. **The ground truth comes from the slot, not from the writer.**
3. The writer agent (Claude Sonnet, agent session, no API cost) writes subject and body for each slot.
4. The blind checker agent (Claude Haiku) labels without the slot. Disagreements follow the existing runbook (rewrite, drop, or `borderline:` note).
5. Code checks: data rule (reserved domains, no long numbers), language, length and HTML spread, thread links.
6. Owner audit: 30 random cases + up to 20 contested cases per corpus version, in one CLI list (about 15 min). The owner's verdict overrides both agents.

This answers the self-bias finding (§4): the generator family (Claude) differs from the classifier family (OpenAI `gpt-6-luna`, Gemini Flash-Lite); labels are fixed before the text exists; diversity is checked by code; real labels stay the arbiter.

### 2.3 Urgency context

Profile per scenario executive: VIP people (become real VIP sender rules in the sim org), key topics or projects, open deadlines with dates. Each `urgent` slot has one `urgency_source`: `text` (the mail says it), `vip` (sender), `context` (topic or deadline from the profile). The report splits `urgent` recall by source. Today's classifier sees only `text` and `vip`; the `context` column is the E3 work list. The data shape must be the one the product setting will use (E3 prompt, E4 editor), so the lab does not invent a second format.

### 2.4 Live lab: the sim stack

- A second Compose project (`deploy/compose.sim.yaml`, project name `ea-sim`) on the VPS: the same server image, its own database, a GreenMail service, a fake Telegram service, `MAIL_ALLOW_LOCAL_HOSTS=true`, `TELEGRAM_API_ROOT` = the fake, `LLM_DAILY_CAP` sized for 150 mails a day plus drafts. Web on a second `tailscale serve` port, tailnet only.
- No outbound mail path: GreenMail delivers only to its own users and does not relay. A bug in the sim cannot mail a real person.
- Injector: sends each mail of the week at its planned time to the sim mailbox through GreenMail SMTP, with the persona's own `From`, `Message-ID`, `In-Reply-To`, `References`.
- Delegate bots: one GreenMail user per delegate; a loop reads its inbox and acts per the slot: reply done, reply late (after the reminder), out-of-office auto-reply, reply from another address (F040 case), no reply (the chaser must fire).
- Scripted executive: taps approve, reject or edit on drafts and Undo on wrong moves, per the ground truth, through the fake Telegram driver now and through the E4 API commands when they exist. It never acts outside its own stack.
- Week scorer: reads the sim DB (triage rows, actions, audit, outbox with timestamps) and writes the report to `evals/results/sim-<date>-<scenario>-<run>.md`.
- Real time: the code has no clock to speed up, and reminders (48 h), expiry and digests need real days. A **live day** (one weekday of the scenario) is the routine smoke; the **live week** runs before the Stage 2 exit and after a large E3, E5 or E6 change.
- Fallback if the VPS lacks RAM or disk (3.8 GB free on 2026-11-11, RAM unknown): the same stack on the owner's PC for live days; the week waits for the E8 answer.

### 2.5 Draft judge

Code checks first (recipient is the expected delegate or the sender, no `@`/link/long number from mail text, language matches, quote present). Then an LLM rubric (facts kept, task clear, tone fits the persona, no invented promise, injection ignored) from a model family other than the drafter's (drafter OpenAI → judge Gemini through the existing provider switch). Scores delegation drafts now; E6 plugs the reply planner into the same judge.

### 2.6 Budget (measured cost basis)

`gpt-6-luna` classifier: $0.000143 per mail (`evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`).

| Run | Calls | Expected | Cap (runner stops) |
| --- | --- | --- | --- |
| Offline bank, full | ≈ 1,500 classify + ≈ 300 plan/draft + ≈ 300 judge | ≈ $0.30–0.50 | $1 |
| Live day | ≈ 150 classify + drafts | ≈ $0.05 | — (inside the week cap) |
| Live week | ≈ 830 classify + ≈ 100 drafts + judge | ≈ $0.30–0.60 | $5 |
| Lab per month | all of the above | < $10 | $20 |
| Corpus generation | Claude agent sessions | $0 API cost (owner's subscription time) | — |

## 3. Cross-epic notes

| Item | Today in | Proposal |
| --- | --- | --- |
| F028 `/review` command (real labels) | Not in any epic | Into E2a: real labels need calendar time; start them first |
| F057 testmail mail kind | Not in any epic | Into E2a: keeps old AgentMail test mail out of the real labels |
| F065 `delegation` expected in compare | E2 | Absorbed; the week scorer and `compare` both accept `delegation` |
| F066 AgentMail delegate persona | E2 | Replaced by GreenMail delegate bots |
| F040 delegate reply from another address | E9 "if the simulator shows it matters" | Stays in E9; E2 plants the case and reports it |
| Urgency context: prompt | E3 | Stays in E3; E2 gives the data shape and the per-source recall |
| Urgency context: settings editor ("what is urgent for me") | Nowhere | Add to E4 next to the style text editor |
| Staging stack on the VPS | E8 Should | E2b builds the sim stack; E8 reuses it as staging later. E8 discovery answers the RAM question for both |
| Release checklist with the eval gate | E8 builds the checklist; E2 the gate | E8's checklist gets the step "model or prompt changed → `eval --sim` holdout report attached" |
| Draft quality eval | E6 second pass waits for "first E2 eval of draft quality" | Trigger becomes "E2 draft judge exists and the E6 stage-1 prototype ran on the bank's `needs_reply` holdout" |
| Waiting-for-reply cases | E5 | E2 plants threads the executive started (Sent side) in the week; the live run needs E5's Sent sync to score them, so their score starts in E5 |
| Demo organization | E2 (build), E10 (video) | E2b; E10 uses the reset command for its demo. Telegram screenshots for E10 come from the fake or a later choice in E10 |
| Load test 10 orgs × 200 mails | E8 Should | Stays in E8; it uses the E2 injector |

E3 and E10 need only E2a (the offline report). E6 needs E2a (judge). Only the M5 latency number and the demo need E2b.

## 4. Research (web, read 2026-11-13)

| Fact | Source | Use |
| --- | --- | --- |
| LLM-generated benchmarks favour the model that generated them; test-set generation and LLM judging compound; more source diversity only partly helps | Xu et al., "When LLMs Benchmark Themselves", arXiv 2509.26600 v3, 2026-08-30 | Different family for generator and classifier; judge from a family other than the drafter; real labels stay the arbiter |
| Self-bias in LLM-made benchmarks comes from question domain, language style and wrong labels | SILENCER, NeurIPS 2025 proceedings | Label first (no wrong labels from the writer), style-diversity checks, blind checker |
| EmailBench: 206 scenarios on a deterministic synthetic Enron-inspired corpus, scored by 258 static assertions plus 211 LLM rubrics; best model passed 33.5% | arXiv 2609.31906, 2026-09-25 | Confirms the pattern: deterministic synthetic corpus + code assertions + rubric. Our week scorer and draft judge follow it |
| Enron corpus: about 500k mails of about 150 people from 2001, released by FERC; all attachments stripped; some mail removed at employees' request | CMU page `cs.cmu.edu/~enron`; Craig Ball, EDRM, 2025-08-15 | Drift check value is low: no SaaS notifications, no mobile, no Polish, no GDPR-era mail; real people's data. Dropped from E2 (decision 7) |
| AgentMail limits: Free 3 inboxes, 100 mails/day; Developer 10 inboxes, 1,000/day; agent self-sign-up 1 inbox, 10/day | `docs.agentmail.to/knowledge-base/rate-limits.md`, read 2026-11-13 | Too small and too US-hosted for persona inboxes at 150 mails/day; GreenMail instead |
| "Fake customers with real addresses that reply in character the same way every time" as a test product for email agents | joinmilo.email (vendor page, marketing) | The deterministic delegate-bot pattern is current practice |
| Fyxer drafts expire after 14 days; style from about 300 sent mails | 04-review-result §3 (vendor pages 2026, marketing) | Input to E6, not E2 |

Search providers were rate-limited for part of the session (Exa 429); no claim here depends on an unread page.

## 5. Size

| Ticket | Stages | Source lines | Content |
| --- | --- | --- | --- |
| E2a Offline lab | ≈ 14 | ≈ 3k | Scenario format and validator, planner, writer/checker tasks for scenarios, owner audit list, bank + holdout loader, `eval --sim` with worker pool and budget cap, report additions (per language, per urgency source, Wilson bound, cost), draft judge, model-upgrade gate rule, F028, F057, F065 |
| E2b Live lab | ≈ 16 | ≈ 4k | Sim stack (compose, env, tailnet port), injector, delegate bots, scripted executive, week scorer, live-day and live-week commands, demo org with reset, runbook |
| **Total** | **≈ 30** | **≈ 7k** | Same as the epic page (28 / 7k); Enron and AgentMail delegates out, sim stack and judge in. Corpus generation is agent time, not stages: about 60 writer batches of 25 for the bank and the week |
