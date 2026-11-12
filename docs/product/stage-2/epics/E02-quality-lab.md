# E2 · Quality lab

> Tier: Must. Status: ready to plan (discovery 2026-11-13, PD-013–PD-028). Size: about 30 stages, 7k lines, two tickets (E2a offline, E2b live). Detail: `E02-discovery-notes.md`. Owner idea: "create more synthetic emails that will mock behaviors".

## Outcome

Every category and every flow has measured precision and recall on realistic executive mail at realistic volume, without a second real mailbox. The same lab gives the demo organization.

## Users

Owner and agents (quality), later the demo viewer (E10).

## In scope

- **Scenario generator**: a company with 10–20 personas (boss, team, delegates, clients, vendors, newsletters, systems, spammers, a phishing actor), Polish and English, threads over days, 100–200 mails a day. Each mail carries its ground truth (category, expected delegate, urgent reason, expected action) in a sidecar, never in the mail.
- **Urgency context** (R3): the persona's "what is urgent for me" (people, topics, deadlines) is an explicit input to the generator and to the classifier prompt. Without it, "urgent" has no ground truth.
- **Live delegates**: AgentMail persona inboxes that receive delegations and answer: done, late, other address, out of office (F065, F066, F040).
- **Two runners**: offline eval on the generated set (fast, every prompt change, in CI with a budget); live run on a dedicated test mailbox (PD-006) through the real pipeline for a "simulated week", scored automatically (`testmail-checker` becomes the scorer).
- **Report**: per-category precision and recall, false-negative rate on `urgent` and `needs_reply`, go/no-go table, M1–M5 and M7 on the simulated week. Same format each run, stored in `evals/results/`.
- Hard cases on purpose: injection, VIP mail that looks like spam, urgent with no "urgent" word, delegation with missing data, forwarded mail in a thread, Polish diacritics, HTML-only, attachments, waiting-for-reply threads (for E5), reply-needed threads (for E6).
- A public business corpus (Enron, English) as a drift check against the own generator.
- Demo organization filled by the simulator: safe demo with no real mail.
- Model-upgrade gate: a new model or prompt must pass the offline eval and the real-label eval before deploy.

## Out of scope

Classifier changes (E3). A second real mailbox. Load tests beyond 200 mails a day (E8 should tier).

## Dependencies

E1. Blocks E3, E6, E10.

## Open product questions

1. Generator model: a different model family than the classifier, to avoid self-confirmation (review proposal: yes).
2. Volume and languages of the default scenario: 150 mails a day, 60% Polish? Owner's picture of the target executive decides.
3. Which real labels count as the final arbiter: the pilot mailbox labels from `/review` (F028) only, or also hand labels on Enron.
4. Budget per offline run and per simulated week (LLM cost).

## Risks

- Self-confirmation: the generator writes mail the classifier finds easy. Mitigation: a second model, the public corpus, the hard-case list, real labels.
- Test traffic in the pilot mailbox: use the separate mailbox (PD-006).

## Exit

- `bun run eval --sim` prints the full report in under 10 min; the live simulated week runs end to end on the test mailbox with a scored report.
- The demo organization exists on dev and on the VPS.
- Every category has at least 200 ground-truth cases; the hard-case list is covered.

## Discovery (2026-11-13)

### Verdict: modify and split

The outcome is right for the thesis: M1 ("nothing slips") and M8 (earned autonomy) cannot be measured without this lab. Four changes:

1. **Split** into **E2a Offline lab** (scenario, corpora, `eval --sim`, report, draft judge, gate, real labels) and **E2b Live lab** (sim stack, injector, delegate bots, scripted executive, week scorer, demo). E3, E6 and E10 need only E2a, so the critical path E1 → E2 → E3 gets shorter.
2. **Live run on a separate sim stack** with GreenMail and the fake Telegram, not on a real mailbox and not through AgentMail (ADR 0021 draft).
3. **Drop Enron.** Replace it by a sim-vs-real gap check on the categories that have real labels (`notification`, `spam`).
4. **Holdout.** The bank has a dev part for prompt tuning and a holdout part for the gate, so E3 cannot tune on the gate set.

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| Offline runner and report | `triage/eval.ts`, `eval-report.ts`, `bun run eval` (precision, recall, go/no-go, injection, cost) | `--sim` loader, worker pool (sequential today, ≈ 30 min for 1,500 cases), budget cap, per-language and per-urgency-source columns, Wilson bound |
| Cases | 108 in `evals/cases/` | Scenario format, bank (250 per category), realistic week (≈ 830 mails) |
| Writer and checker | `testmail-writer` / `testmail-checker` agents, `validateBatch`, `blindView` | Label-first scenario slots, owner audit list |
| Live sender and scorer | AgentMail tool to the pilot mailbox; `testmail:remote compare` | GreenMail injector, week scorer (M1–M5, M7) |
| Delegates and executive | Fake Telegram driver (taps buttons) | Delegate bots, scripted executive |
| Real labels | `triage:label` CLI, `eval --real` | F028 `/review`, F057 |
| Urgency context | VIP flag only | Profile in the scenario; per-source recall |
| Demo org, draft judge, gate | `org:create`, e2e seed; prompt-file convention | Sim-stack demo with reset; judge; gate step |

Page corrections: `testmail-checker` is the blind labeler, not the scorer (`compare` is). AgentMail cannot host the delegate personas (3 inboxes on Free, `From` override dropped). GitHub CI has no LLM key; the gate is a release step.

### Cross-epic notes (edits for the other pages; detail in the notes §3)

- E3: depends on E2a only; the urgency-context prompt reads the E2 profile shape.
- E4: add a "what is urgent for me" editor (VIP people, topics, deadlines) next to the style text.
- E6: second-pass trigger becomes "E2 draft judge exists and the E6 prototype ran on the `needs_reply` holdout".
- E8: the sim stack is the later staging stack; E8 discovery checks VPS RAM and disk for it; the release checklist gets the eval-gate step.
- E10: depends on E2a for numbers, E2b for the demo.
- F028 and F057 move into E2a. F065 absorbed. F066 replaced by GreenMail delegate bots. F040 stays in E9.
- Applied 2026-11-13 to E4, E6, E8, E10. Not applied to E3: its discovery session was running. That session (or its second pass) applies the E3 line and the E3 trigger text in `05` §3: "first E2a `eval --sim` report".

### Research (sources in the notes §4)

- LLM-made test sets favour the model family that made them; generating and judging compound (arXiv 2509.26600, 2026-08-30; SILENCER, NeurIPS 2025). → Different family for generator and classifier, labels fixed before text, real labels as arbiter.
- EmailBench (arXiv 2609.31906, 2026-09-25) uses a deterministic synthetic corpus with code assertions plus LLM rubrics. → Same pattern for the week scorer and the draft judge.
- Enron is 2001 mail of real people, no SaaS notifications, no Polish (CMU; EDRM 2025-08-15). → Dropped.
- AgentMail Free = 3 inboxes, 100 mails/day (docs, read 2026-11-13). → Not the persona host.

### Decisions (owner 2026-11-13: "go with defaults"; rows PD-013–PD-028)

1. Split into E2a Offline lab and E2b Live lab; E3, E6, E10 wait only for E2a. [yes]
2. Generator: Claude Sonnet in agent sessions writes the text; ground truth comes from the planned slot ("label first"); Claude Haiku labels blind; the owner audits 30 random + up to 20 contested cases per corpus version (≈ 15 min). [yes]
3. Two frozen corpora in git: a bank of 250 per value category (50 dev + 200 holdout) plus the hard cases, and a realistic week of 150 mails per weekday and 40 per weekend day. [yes]
4. Languages: week 70% Polish / 30% English; bank 60/40; a few German mails as hard cases. [yes]
5. Urgency context: one profile per scenario executive (VIP people as real VIP rules, topics, deadlines); each urgent case carries its source (text, VIP, context); the report gives urgent recall per source. Prompt in E3, editor in E4. [yes]
6. Arbiter: only real labels on the pilot mailbox decide `auto` on real mail; F028 and F057 move into E2a so labels start early. [yes]
7. Enron: drop; the sim-vs-real gap check on `notification` and `spam` replaces it. [drop]
8. Live lab on a separate sim stack (second Compose project, own DB, GreenMail, fake Telegram, no outbound mail); ADR 0021 draft. If the VPS is too small (E8 check), live days run on the owner's PC. [yes]
9. Delegates are GreenMail bots (done, late, out of office, other address, silent); the scripted executive taps through the fake Telegram now, through E4 API commands later. AgentMail leaves the lab. [yes]
10. Real time, no clock compression: a live day is the routine smoke; the live week runs before the Stage 2 exit and after a large E3/E5/E6 change. [yes]
11. Budget caps (the runner stops): $1 per offline run, $5 per live week, $20 per month. Expected: about $0.40 and $0.50. [yes]
12. Gate statistics: the sim gate needs ≥ 200 holdout cases per category and shows the Wilson 95% lower bound; the real-label gate keeps ≥ 30 rows. [yes]
13. Model-upgrade gate: a release-checklist step and a rule for any ticket that changes a prompt or model (holdout report in `evals/results/`); no LLM key in GitHub CI. [yes]
14. Draft judge in E2a: code checks plus a rubric from another model family than the drafter (Gemini judges OpenAI drafts); scores delegation drafts now, E6 reuses it. [yes]
15. Demo org in the sim stack: fed from the realistic week, 3 days shadow then assist, one reset command, tailnet only. [yes]
16. Hard-case list additions: auto-replies and bounces, calendar invites, CC-only and list mail, a thread the executive already answered, German mail. [yes]
17. Apply the cross-epic edits above to the E3, E4, E6, E8 and E10 pages in this change. [yes]
18. Commit by explicit path: `docs/product/` was never committed, so the commit adds every file of `docs/product/stage-2/` by name, plus the ADR draft and the note. [yes]

### Planned tickets

| Ticket | Effect | Into |
| --- | --- | --- |
| F028 `/review` command | Absorbed | E2a |
| F057 testmail mail kind | Absorbed | E2a |
| F065 testmail `delegation` label | Absorbed | E2a (compare and week scorer accept `delegation`) |
| F066 AgentMail delegate persona | Replaced by GreenMail delegate bots; drop the ticket when E2b is planned | E2b |
| F040 delegate reply from another address | Not absorbed; stays in E9; E2b plants and reports the case | — |

`plan-task` runs twice: E2a first, then E2b. The tickets (`spec/features/`) are not changed by this session.

### Size and risks

Size: about 30 stages, 7k lines (E2a ≈ 14 / 3k, E2b ≈ 16 / 4k); corpus writing is agent time, about 60 writer batches.

| Risk | Mitigation |
| --- | --- |
| Self-confirmation: the sim is easier than real mail | Other family, label first, blind checker, owner audit, gap check against real labels |
| E3 tunes on the gate set | Dev/holdout split; E3 tickets may not open the holdout file |
| One writer gives one style | Code checks on length, HTML share, thread depth, signatures; persona voices |
| VPS RAM or disk (3.8 GB free) too small for the sim stack | E8 check first; PC fallback for live days |
| A scripted tap reaches a real person | Separate stack; GreenMail does not relay; the executive script has no access to production |
| Owner attention for audits | Fixed cap of 50 cases per corpus version |
| Urgency profile shape drifts from the later product setting | One shape, defined in E2a, read by E3 and E4 |

## Input from the E3 discovery (2026-11-13, PD-056–PD-068)

- The E2b week scorer calls the E3a metric module (`packages/core`): one definition per metric (PD-056).
- E3b tunes prompt v3 only on the dev set; the holdout runs only as the gate (PD-015, PD-061).
- The week plants phishing cases that try an urgent push, a delegation and an unsubscribe; M3 counts an unwarned urgent push (PD-057, PD-063).
- The week also checks the PD-044 send limits (PD-068).
