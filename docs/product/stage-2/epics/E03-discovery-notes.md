# E3 · Measured core — discovery notes (2026-11-13)

> Detail for the "Discovery" section of `E03-measured-core.md`. Written by the E3 discovery session (Opus 5.5). The next agent has no chat history: everything the decisions rest on is here. The E2 discovery (same day) is in `E02-quality-lab.md` and `E02-discovery-notes.md`; the owner accepted all its defaults as PD-013 to PD-028 (`decisions.md`).

## 1. What exists today (code cross-check, read 2026-11-13)

| Item of the epic | Exists today (file or module) | Partly there | New |
| --- | --- | --- | --- |
| M1 missed important mail | `triage_feedback` (sources `cli`, `telegram`, `undo`, `imap_move`, `web`) with `true_category`; moved-back detection `apps/server/src/modules/triage/returned.ts` writes feedback; `computeMetrics` in `packages/core/src/triage/metrics.ts` (precision, recall, confusion) | Feedback says "wrong", not always the true category. No query "important mail the system missed per week". Flags are fetched once at sync (`FolderMessageMeta.flags`, `mail/port.ts`) and never again | Weekly M1 query; `\Answered` re-check of recent INBOX mail; targeted `/review` queue (F028 is in E2a) |
| M2 open loops on time | `delegations` table: `due_at`, `sent_at`, `answered_at`, `status`, `reminders_sent`, `last_reminder_at`; chaser every 15 min, gap 3 days, max 2 reminders (`delegation/chaser.ts`, `repo.ts`) | All data exists for delegations | Weekly M2 query (delegations now; E5 adds waiting-for-reply and commitments) |
| M3 serious mistakes | `actions` statuses (`rejected`, `undone`, `applied`), `audit_log`, returned-mail feedback | A reject has no reason; a sent mail has no "this was a mistake" signal | Reject reason (wrong person / wrong content / not needed); "mistake" button on the send result; weekly M3 query |
| M4 handled share | Data exists (`actions.applied_at`, `undone`, feedback, `delegations`) | — | F033 (line) + F042 (delegations) |
| M5 urgent latency | `outbox` row `kind = 'urgent'` with `sent_at`; `emails.received_at` (INTERNALDATE) | Sync runs every 5 min (`main.ts:82`, `*/5 * * * *`); triage worker and notifier every 15 s. Worst case ≈ 5.5 min, so p90 < 5 min is not reachable today | Latency query; sync every 2 min; IMAP IDLE stays E8 Should |
| M7 unit cost | `triage_results.tokens_in/out/model`; `packages/core/src/triage/cost.ts` (price table with dates and sources); `bun run triage:cost`; eval report "cost per mailbox per month at 200 mails a day" | Drafts and plan calls: tokens in `llm.call` audit rows, not in the cost script; no hosting share | Weekly M7 = LLM (all calls) + hosting share; input to `docs/cost-model.md` (E7 S6e) |
| M8 per-category precision and recall | `bun run eval`, `eval --real`, `eval-report.ts`, go/no-go gate `triage/gate.ts` (`GATE_BAR` 0.98, `GATE_MIN_KEPT` 30 in `packages/core/src/web/settings.ts`); `setCategoryAutoWithGate` | Wilson bound, holdout: E2a | M8 in the weekly report (real labels) next to the latest holdout run |
| Weekly report | Daily digest `reports/digest.ts`; activity page | No weekly message, no stats page (`apps/web/src/pages`: no stats); PRD US-013 open | Weekly message + stats page + stats API command |
| Per-category thresholds | `mailbox_settings` threshold per category; threshold sweep in the eval report | Sweep on 2026-11-07: precision flat from 0.50 to 0.90 for every category (model confidence is almost always high) | Not a lever on its own; see §2.4 |
| Folder hint (F061) | `emails.folder`; sort folders (F058) | No hint in the prompt | Eval-gated experiment |
| Urgency context (R3) | Only `SenderContext { whitelisted, vip, noreply }` reaches the prompt (`triage/classifier.ts`) | VIP sender rules | Profile storage (shape from E2a), prompt v3 input; editor in E4 |
| Few-shot from corrections | — | — | Replaced by a counts-only sender history hint (§2.5) |
| Phishing flag | Hard rules (whitelist, VIP, blocklist) before the LLM; injection marking `markUntrustedText` | Only the address of `From` is kept (`mail/imap/mapper.ts`): no display name, no `Reply-To`, no `Authentication-Results`, no link hosts | Header capture (migration) + rules + effects |
| Attachments | `mailparser` `simpleParser` already parses the full source (`mapper.ts:80`); only text is kept | Attachment list is parsed and dropped | Store name, type, size; prompt and summary input |
| Cold-mail sub-label | `reason_code` column in `triage_results` | — | A reason code under `spam` / `notification`, no new category |
| Model per decision | `triage_results.model`, `prompt_version` | — | — |
| Model-upgrade gate | Convention in `prompts/classifier-v2.ts:5` | — | Rule and release step: E2a |
| Provider fallback (F072) | Provider switch (ADR 0015), one provider per server; pause on errors (`triage/pause.ts`) | — | Deferred; degraded-mode notice instead (§2.6) |
| Budget alerts (F073, F023) | `LLM_DAILY_CAP` (default 300) | Pause text names no quota cause | F073: `http_429_quota` named in `/status` and digest, dashboard steps |

Corrections to the epic page:
- The cost path in "In scope" (cheap first pass, caching, rules before the LLM) is not needed for M7: the classifier costs $0.86 per mailbox per month (§3). Hard rules already run before the LLM (`triage/service.ts:432`). The epic keeps the measurement and drops cost-reduction work unless the weekly M7 says otherwise.
- "Per-category thresholds" are a weak lever: the threshold sweep is flat (§2.4).
- "Few-shot from user corrections" puts the text of other mails into the prompt. It conflicts with retention (bodies are cleared) and widens the injection surface. Replace by counts (§2.5).
- M5 < 5 min is out of reach with the 5-min sync. The epic must change the sync interval or the metric fails by design.

## 2. Design sketch the decisions rest on

### 2.1 One metric module, two feeds

- Pure metric definitions in `packages/core` (one function per metric, input = rows, output = numbers and counts). Server queries in a `reports` (or `metrics`) module read the DB for one organization and one week.
- Two feeds use the same functions: the weekly report on real mail (E3) and the E2b week scorer on the sim stack. E3 stage 1 builds the definitions; if E2b lands first, it builds them in the same place and E3 reuses them. One definition, never two.
- Every number has its count next to it ("M1 1.4% (2 of 140)"), so a small week is not read as proof.

### 2.2 Metric definitions (proposed defaults)

| # | Numerator | Denominator | Real-mail sources | Sim source |
| --- | --- | --- | --- | --- |
| M1 | Mail whose true label is `urgent` or `needs_reply` and that the system labelled otherwise | All mail whose true label is `urgent` or `needs_reply` (found misses + predicted ones not corrected) | Corrections (Telegram, web, CLI), `/review` labels, moved back + label, `\Answered` mail that the system did not mark `needs_reply` → confirmed in `/review` | Ground truth |
| M2 | Delegations answered or chased (a reminder went out) by `due_at`, else by `sent_at` + 3 days | Delegations due in the week | `delegations` rows | Same |
| M3 | Serious events (§2.3) | Per user per week | Actions, audit, reject reasons, "mistake" taps | Ground truth + the same events |
| M4 | F033 + F042 rule | All triaged mail in the week | `actions`, feedback, `delegations` | Same |
| M5 | p90 of (urgent notice `sent_at` − `received_at`) | Urgent notices in the week | `outbox`, `emails` | Same |
| M7 | LLM cost of all calls (classify, plan, draft) + hosting share + backup share | Per mailbox per month, scaled from the week | `triage_results`, `llm.call` audit rows, `cost.ts` | Same |
| M8 | Precision and recall per category, Wilson 95% lower bound | Labelled rows | Real labels (`eval --real`) | Holdout run (E2a) |

Real-mail M1 is a lower bound: the user finds only some misses. The report says so in one line. The random part of `/review` (E2a, F028) gives the unbiased estimate; the `\Answered` part finds likely misses for one-tap confirmation.

`\Answered` is the IMAP system flag "message has been answered" (RFC 9051 §2.3.2). Mail clients set it when the user replies. Whether Interia webmail and phone clients set it is not checked: stage 1 of the plan checks it on the pilot mailbox. If they do not set it, the signal is dropped and M1 rests on labels only.

### 2.3 M3: what counts as serious

Counts (each one event):
1. **Hidden important mail**: an applied (not shadow) automatic move of mail whose true label is `urgent`, `needs_reply` or `delegation`. Truth from a correction, `/review`, or a move back with a label. Also any whitelisted or VIP mail moved to spam (the rules should make this impossible; it counts if it happens).
2. **Wrong person**: a draft rejected with the reason "wrong person", or a delegation the user reassigns or the delegate answers "not mine" (E2b plants this case).
3. **Wrong content**: a draft rejected with the reason "wrong content" (invented fact, wrong tone, unsafe text).
4. **Sent but wrong**: the user taps "this was a mistake" on the send result within 7 days.
5. Sim only: phishing mail pushed as an urgent notice without the warning.

Does not count: a reject with "not needed" or no reason; edits before approval; Undo of a move of unimportant mail (that lowers M4). M1 and M3 overlap on purpose: a hidden urgent mail is both a miss and a serious mistake.

New capture: after a reject, one optional row of three buttons (Telegram) or a select (panel, E4 approvals page). A skipped reason is reported as "reason unknown", never as serious.

### 2.4 Thresholds and confidence

The 2026-11-07 sweep (`evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`) keeps the same precision from 0.50 to 0.90 in every category: the model reports high confidence on almost every mail. Studies find verbalized LLM confidence overconfident, worst on hard cases (§3). So a higher threshold does not buy precision. The levers that can: more context in the prompt (urgency profile, folder, sender history, attachments), a second opinion before a hide (§2.6 escalation), and rules. The per-category threshold setting stays; the report shows the sweep so its effect is visible.

### 2.5 Sender history instead of few-shot text

Few-shot examples from corrections would copy the text of other real mails into each prompt: more tokens, more injection surface, and text that retention deletes. Instead the prompt gets counts for the sender: "past labels for this sender: notification 5, needs_reply 1; user corrections: 1 to needs_reply". Counts come from `triage_results` and `triage_feedback`, never from mail text. It ships only if the E2a dev set shows a gain and the holdout gate passes. E11 later replaces it with the contacts model.

### 2.6 Escalation and degraded mode

- **Escalation (conditional)**: a stronger model (today `gpt-6.1-terra`, 10× the price) checks a mail only when the cheap model's answer would hide it (an automatic move out of INBOX) and the sender is a person (not `noreply`, not a list), or when the cheap model returns `unsure`. Expected share: 10–20% of mail. Built only if the E2a holdout shows `urgent` or `needs_reply` recall below target and the stronger model closes the gap on the dev set. No per-category model setting for the user.
- **Degraded mode (instead of F072)**: when the LLM pauses, mail from VIP and whitelisted senders gets a short notice "mail from <sender>, not triaged yet" (ids and sender only, no content). Mail waits and is triaged after the pause, as today. No second provider, no second sub-processor.

### 2.7 Phishing and suspicious mail

Header capture (one migration, in the mail module): `From` display name, `Reply-To`, `Return-Path`, the topmost `Authentication-Results` added by the receiving server (RFC 8601), `List-Unsubscribe` (E4 needs it), attachment list (name, content type, size), link hosts from the HTML part. All under the retention rule of the mail text.

Rules (code, before the LLM, each a reason code):
- `auth_fail`: DMARC fail, or SPF and DKIM both fail, in the receiving server's own result.
- `lookalike_domain`: the sender domain has the same UTS #39 skeleton as, or edit distance 1 from, a domain the user knows (own domain, delegate, VIP, whitelist, frequent senders) but is not equal.
- `display_name_spoof`: the display name contains an address or the name of a VIP or delegate while the address is unknown.
- `reply_to_mismatch`: `Reply-To` domain differs from `From` domain on mail from an unknown sender.
- `link_mismatch`: link text shows one host and the link points to another.
- `risky_attachment`: executable, script, macro-enabled office file, or a password-protected archive.

Effects: the flag is a warning, not a move. The urgent notice and the digest row carry "⚠ suspicious: <reason>". A flagged mail gets no reply draft and no delegation draft (a forwarded fake invoice to accounting is the worst case). The flag never removes a whitelist or VIP decision; it adds the warning. The phishing actor and hard cases of E2 measure it; the target is recall on the planted phishing cases and zero flags on whitelisted mail in the holdout.

Unknown: whether Interia and other own-domain hosts add `Authentication-Results`. Stage 1 checks the pilot headers (read-only). Without it, `auth_fail` is off for that host and the other rules still run.

### 2.8 Attachments

Name, type and size go into the classifier prompt as untrusted text (marked like the body) and into the summary line ("2 attachments: invoice.pdf, 120 kB"). Never the file content, never the file to Telegram. File names count toward the injection eval.

### 2.9 Urgency context storage

The shape comes from E2a (VIP people as sender rules, topics, deadlines with dates). E3 stores it per mailbox (settings JSON or its own table; plan decides), feeds it into prompt v3, and gives one API command to set it (CLI until E4 builds the editor). Topics and deadlines are the user's own data; they go to the LLM provider like the mail, under the same data terms.

### 2.10 Weekly report

- Weekly message (Telegram, and mail digest when E4 builds it), Monday at the digest time: three headline lines (M1, M2, M3 with counts), then M4, M5, M7, and one line per category on `auto` with its M8 precision.
- Stats page in the panel (read-only): the same numbers for the last 8 weeks, per mailbox. E4's autonomy page and E7's operator console read the same API command.
- The daily digest gets the handled-share line (F033, F042).

### 2.11 Sync interval for M5

Sync every 2 min instead of 5 (`main.ts:82`). Worst case then ≈ 2.5 min plus triage and notice; p90 < 5 min holds. One IMAP login per mailbox every 2 min is normal client behaviour; stage 1 watches the pilot host for throttling. IMAP IDLE stays in E8 Should and would replace polling for INBOX later.

## 3. Research (web, read 2026-11-13)

| Fact | Source | Use |
| --- | --- | --- |
| `gpt-6-luna`: $0.10 input, $0.01 cached input, $0.50 output per 1M tokens; Batch and Flex 50% off; `gpt-6.1-terra` $1.00 / $5.00; regional (EU) processing +10% for models from 2026-03-05 | OpenAI pricing page `developers.openai.com/api/docs/pricing`, read 2026-11-13 | M7 estimate; escalation cost; EU processing cost note for E7 |
| Hetzner CX23 (2 vCPU, 4 GB, 40 GB): €5.99 per month with IPv4; prices rose twice in 2026 (April, June) | pikkly.dev price table, checked 2026-11-10; cloudhim.com 2026-10-30; Hetzner docs price adjustment (archived 2026-05-13). Third-party aggregators | Reference hosting share for M7 (portable install) |
| Verbalized LLM confidence exceeds accuracy on average; overconfidence is largest on hard tasks | Michael et al., "Confidence Calibration in Large Language Models", arXiv 2605.23909, 2026-04-03; Xiong et al., arXiv 2306.13063 (ICLR 2024) | Thresholds on self-reported confidence are a weak lever (§2.4) |
| Cascade: cheap model first, a checker decides, escalate only unreliable answers | Chen, Zaharia, Zou, "FrugalGPT", arXiv 2305.05176, 2023 | Escalation design (§2.6), with "would hide a person's mail" as the checker |
| `Authentication-Results` carries the receiving server's SPF, DKIM, DMARC results for the MUA and filters | RFC 8601 (2019) | `auth_fail` rule reads only the receiving server's header |
| DMARC pass does not prove a look-alike domain is safe; compare `From` with `Reply-To` and `Return-Path` | Palisade, 2026-08-11 (vendor blog); MailDingo guide (undated, vendor) | `lookalike_domain`, `reply_to_mismatch` rules |
| Display-name spoofing: the display name shows an address that is not the real `From` | Broadcom Messaging Gateway KB 382647; Microsoft Defender blog 2022-09-20 | `display_name_spoof` rule |
| Confusable strings share a UTS #39 skeleton; libraries exist for JS (`ipfy/Homoglyph`, UTS #39 17.0) | unicode.org/reports/tr39; github.com/ipfy/Homoglyph (license and upkeep not checked) | `lookalike_domain`; the plan checks the library or ports the skeleton table |
| Competitors report time saved ("4+ hours per week") and task counts, not misses | Superhuman blog 2026-11-03 (marketing); Asian Efficiency on Lindy 2026-04-24 | A weekly report that leads with misses and mistakes is a differentiator for "nothing slips" |
| `\Answered`: IMAP system flag, "message has been answered" | RFC 9051 §2.3.2 (from the standard; client behaviour not checked) | M1 signal, checked on the pilot in stage 1 |

Search providers were rate-limited for part of the session (Exa 429). No decision rests on a page that was not read, except the client behaviour of `\Answered` and `Authentication-Results` on Interia, which stage 1 checks.

## 4. M7 estimate (per mailbox per month, 200 mails a day)

| Part | Basis | $ per month |
| --- | --- | --- |
| Classifier | Measured $0.000143 per mail (1,036 in / 80 out tokens) | 0.86 |
| Delegation plan and draft | ≈ 7% of mail, ≈ 2.5k in / 400 out on `gpt-6-luna` | ≈ 0.2 |
| Reply drafts (E6) | ≈ 13% of mail, same size | ≈ 0.35 |
| Escalation (if built) | 15% of mail on `gpt-6.1-terra` | ≈ 1.3 |
| Hosting share | CX23 €5.99 ≈ $7.1 / 20 mailboxes (assumption until the E8 load test) | ≈ 0.35 |
| Backup, domain | B2 and domain, shared | < 0.1 |
| **Total** | | **≈ 1.8 without escalation, ≈ 3.2 with it** |

Target ≤ $5 (20% of a $25 placeholder) holds with margin. It breaks only if every mail goes to the stronger model (≈ $8.6 for the classifier alone). So the cost question is "how much escalation", and E2a numbers answer it.

## 5. Cross-epic notes (edits for the other pages; the owner approves)

| Item | Today in | Proposal |
| --- | --- | --- |
| E3 split | E3 waits for E2 | E3a Measure needs only E1 and starts in wave 1; E3b Improve needs E2a |
| Metric definitions | E3 and E2b week scorer | One module in `packages/core`; E3a builds it; E2b's week scorer calls it |
| Reject reason and "mistake" tap | Nowhere | E3a builds the API command and the Telegram buttons; E4's approvals page shows the reason select |
| Stats API | E3 | E4 autonomy page ("notification: 96% on your mail") and E7 operator console read it |
| `List-Unsubscribe` header | E4 bulk unsubscribe | Captured by E3a header capture; E4 depends on it |
| Urgency profile | E2a shape, E3 prompt, E4 editor | E3b stores it and adds the API command; E4 builds the editor on that command |
| Phishing flag blocks drafts | — | E6: no reply draft for flagged mail; E5: no follow-up draft to a flagged thread |
| Provider port and auth results | E9 | Graph and Gmail adapters must return the same header fields (auth results, display name, attachments) |
| M5 alert | E8 SLO alerts | E8's "urgent latency > 5 min" alert reads the E3 latency query |
| Sync interval | E8 IDLE (Should) | E3a sets 2 min; E8 IDLE replaces polling later |
| Sender history hint | E11 contacts model | E3b counts-only hint (eval-gated); E11 replaces it |
| M7 and the cost model | E7 S6e, E10 pricing | `docs/cost-model.md` reads the weekly M7; E10's placeholder price reads the cost model |
| F072 provider fallback | E3 | Out of Stage 2 (ticket stays planned); degraded-mode notice in E3b |
| F063 junk LLM cap | Nowhere | Stays planned; the weekly M7 and the cap alert show if a spam wave needs it |
| Autonomy evidence (ADR 0028, PD-030) | E4 | E3 adopts its numbers (PD-068); one IMAP-flag store in E3a serves M1 and the history check; the real-label exit line becomes "pass the history check" |

Applied on 2026-11-13 (PD-069): a short "Input from the E3 discovery" section on the E2, E4, E7, E8 and E11 pages.

Not applied yet (E5, E6 and E9 were in session; their session or the first planning session applies them):
- **E5**: no follow-up draft to a phishing-flagged thread (PD-063); M2 for waiting-for-reply and commitments plugs into the E3a metric module (PD-056); the E3a IMAP flags (`\Answered`) are a cheap "you replied" signal before the Sent read.
- **E6**: no reply draft for phishing-flagged mail (PD-063); reply-draft rejects use the same reason buttons and count in M3 (PD-057); reply-draft cost counts in M7 (PD-059).
- **E9**: the Microsoft 365 and Gmail adapters return the same captured fields (display name, `Reply-To`, `Return-Path`, authentication results, `List-Unsubscribe`, attachments, link hosts, flags) behind the `MailProvider` port (PD-063).

## 6. Size

| Ticket | Stages | Source lines | Content |
| --- | --- | --- | --- |
| E3a Measure | ≈ 13 | ≈ 2.3k | Metric definitions and queries M1–M8; weekly message; stats API and page; handled-share line (F033, F042); reject reason and "mistake" tap; `\Answered` re-check and `/review` targeting; sync every 2 min; M7 report (all LLM calls + hosting share); header capture migration (display name, Reply-To, Return-Path, Authentication-Results, List-Unsubscribe, attachments, link hosts); F073; stage 1 = pilot checks (`\Answered`, `Authentication-Results`, throttling) |
| E3b Improve | ≈ 14 | ≈ 2.7k | Phishing rules and effects; attachments in prompt and summary; urgency profile storage and command; prompt v3 experiments (urgency context, folder hint F061, sender history, cold-mail reason code), each on the dev set, gate on the holdout; escalation (conditional); degraded-mode notice; capability pages |
| **Total** | **≈ 27** | **≈ 5k** | Up from 20 / 4k: header capture, phishing rules and the M3 capture were not in the estimate; cost-reduction work leaves |
