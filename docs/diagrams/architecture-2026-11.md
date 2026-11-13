---
title: The email assistant architecture and the foundation plan
summary: One Bun process, modules behind one index each, the database as the work queue, and eight tickets to run before the Stage 2 epics.
chrome: title
width: wide
source: Read from the code at commit 8e446d8 on 2026-11-13. Review text in docs/product/stage-2/06-architecture-review.md.
---

One server process serves the panel, runs the jobs and talks to Telegram. All of it goes through [ten server modules](#modules) that write to Postgres and call the mail host and the LLM. [Two module edges break the border rule](#m-actions), and five seams that the epics assume do not exist yet. So [eight foundation tickets](#plan-critical) run first.

## 01 · What runs where

```figure
id: shape
layout: layers
title: One process, four tiers
grid: [4, 4]
nodes:
  panel:   { label: Web panel, sub: Astro islands, at: [0, 0], kind: actor, about: "A static build served by the server. One React island per page talks only to `/api` with the session cookie. The operator CLI (43 scripts) enters at the module tier and is left out here." }
  api:     { label: HTTP API, sub: "Hono, /api", at: [0, 1], about: "Thin routes: parse the body with a core schema, call one service function, map to JSON. The tenant comes from the session, never from the request." }
  jobs:    { label: Jobs and bot, sub: "croner, 12 jobs", at: [1, 1], about: "Cron jobs in the same process: sync every 5 min, triage and committer every 15 s, notifier, digest, chaser, expiry, retention. The Telegram bot long-polls here too. A tick never overlaps the last one." }
  modules: { label: Server modules, sub: "10 modules, one index each", at: [0, 2], span: [2, 1], focal: true, about: "tenancy, mail, triage, actions, delegation, reports, channels, config, audit, testmail. Each exposes one `index.ts`; others import only that. Ports live in the module that owns them, adapters are folders inside it." }
  core:    { label: packages/core, sub: "pure, no I/O", at: [2, 2], about: "Domain types, Zod schemas, categories, rules, policy, planners, digest texts. No database, no network, no env. The web imports only its `/web` subpath." }
  db:      { label: Postgres 17, at: [0, 3], kind: store, about: "Holds all state and is the work queue: rows with a status, claimed with SKIP LOCKED. Every domain table carries `org_id`. The server connects as the role `app`, migrations run as `migrator`." }
  mailsrv: { label: Mail server, sub: "IMAP 993, SMTP 465", at: [1, 3], kind: external, about: "The user's mailbox, Interia in the pilot. Reached through the `MailProvider` and `MailSender` ports; only the committer changes it or sends." }
  llm:     { label: LLM API, sub: OpenAI or Gemini, at: [2, 3], kind: external, about: "One structured call per mail. The answer is data checked by a Zod schema: category, confidence, reason, fields. It never names a recipient or a folder." }
  tgapi:   { label: Telegram Bot API, at: [3, 3], kind: external, about: "Digests, urgent notices and approval cards go out through the outbox; taps come back by long polling. Only the `channels/telegram` folder imports the SDK." }
edges:
  - panel -> api
  - api -> modules
  - jobs -> modules
  - modules -> core: pure rules
  - modules -> db
  - modules => mailsrv: read, move, send
  - modules => llm: classify
  - jobs => tgapi: poll, send
notes:
  - on: modules
    text: "Every path, HTTP or job, ends in the same module functions. A Telegram tap and a panel click call one service."
  - on: db
    text: "No broker: a status column and a claim query connect the workers, so a crash loses no work."
  - on: core
    text: "Planners and the policy are pure functions here, tested without mocks."
caveat: "Deploy detail is left out: two containers on the home VPS, the panel reachable only through Tailscale Serve."
```

[The module tier](#modules) is where the design lives. [The pure core](#core) under it holds the rules, [Postgres](#db) holds the state, and the three hosts on the right are reached only through ports.

## 02 · How the modules depend on each other

The layers read top-down: channels and reports use the pipeline modules, the pipeline uses mail and config, and everything uses tenancy and audit. [The `actions` module reaches into `delegation/repo.ts`](#m-actions->m-delegation), past the hooks interface that was built to avoid that edge. [The `config` module](#m-config) [imports a type from `actions`](#m-config->m-actions), which closes a cycle through `mail`. Both are cheap to fix, and nothing stops the next one.

```figure
id: deps
layout: layers
title: Module dependencies, with the two broken borders
grid: [3, 4]
nodes:
  m-channels:   { label: channels, sub: "Telegram, outbox", at: [0, 0], about: "Chat linking, the outbox sender, the notice detectors, the digest job, the commands and taps. It calls approve, reject, undo and feedback in the modules below." }
  m-reports:    { label: reports, sub: "digest, activity", at: [1, 0], about: "Builds the digest and the activity rows from triage results, actions and delegations. Read-only over the pipeline modules." }
  m-triage:     { label: triage, sub: "worker, eval", at: [0, 1], about: "Claims pending mail, applies hard rules, calls the classifier, runs the pure planner and policy, and writes the action rows in one transaction." }
  m-actions:    { label: actions, sub: "committer, approvals", at: [1, 1], focal: true, about: "The only module that changes a mailbox or sends. Its repository is 1,776 lines and imports `delegation/repo.ts` directly, past the hooks interface." }
  m-delegation: { label: delegation, sub: chaser, at: [2, 1], about: "Delegates, delegations and the daily chaser. It implements the `DelegationHooks` that `actions` calls back through the composition root." }
  m-mail:       { label: mail, sub: "IMAP adapter, sync", at: [0, 2], about: "The `MailProvider` port, the IMAP and fake adapters, connect, sync, locate, the host guard. 1,251 lines in its repository." }
  m-config:     { label: config, sub: "settings, rules", at: [1, 2], focal: true, about: "Mailbox mode, switches, category policy and sender rules. Its service imports the type `ExpireFilter` from `actions`, which makes the cycle actions, mail, config, actions." }
  m-tenancy:    { label: tenancy, sub: "orgs, users, plans", at: [0, 3], about: "Organizations, users, memberships, plan state, suspend and resume. Every module reads it; the web resolves the tenant from the session here." }
  m-audit:      { label: audit, sub: append-only, at: [1, 3], about: "One `recordAudit` in the same transaction as every status change. Ids, codes and counts only, never mail text. Every module writes it." }
edges:
  - m-channels -> m-actions: approve, undo
  - m-channels -> m-triage: feedback
  - m-reports -> m-actions
  - m-triage -> m-actions
  - m-triage -> m-mail: claims mail
  - m-triage -> m-delegation
  - m-delegation -> m-actions
  - m-actions -> m-mail
  - { from: m-actions, to: m-delegation, label: deep import, about: "`actions/repo.ts:14` imports `openDelegationFilter` from `delegation/repo.ts`. A deep import, and the reverse edge that the hooks pattern exists to prevent." }
  - { from: m-config, to: m-actions, about: "`config/service.ts:19` imports the type `ExpireFilter`. With `mail → config` and `actions → mail` this is a cycle. The type belongs in `packages/core`." }
  - m-mail -> m-config: settings
  - m-config -> m-audit
notes:
  - on: m-actions->m-delegation
    text: "The one deep import in the server. ESLint checks only SDK imports, so nothing caught it."
  - on: m-config->m-actions
    text: "A type-only import still draws a design edge. madge reports 10 cycles, one of them across modules."
  - on: m-audit
    text: "Every module writes audit rows and reads tenancy. Those edges are left out to keep the figure readable."
caveat: "Reads of `tenancy` and writes to `audit` from every module are not drawn. `testmail` is a test tool and is left out."
```

## 03 · The mail pipeline

A mail moves through the pipeline as a row that changes status. [The triage worker](#p-triage) is the one place where the LLM is asked and the plan is written. Nothing here calls the next module directly: each worker claims rows the last one left.

```figure
id: pipeline
layout: flow
title: From a new mail to a mailbox change
grid: [5, 3]
nodes:
  p-llm:       { label: LLM, at: [3, 0], kind: external, about: "One structured call per mail with a Zod output schema. Soft errors pause the whole worker with backoff; hard errors count on the mail row, three of them end as `unsure`." }
  p-notifier:  { label: channels.notifier, sub: every 15 s, at: [4, 0], about: "Queues an approval card only after the draft is in the Drafts folder, then sends through the outbox with per-user limits and quiet hours." }
  p-mail:      { label: Mail host, at: [0, 1], kind: external, about: "INBOX and the synced sort folders are read above a UID cursor per folder. `AI/*`, Sent, Drafts and Trash are never read." }
  p-sync:      { label: mail.sync, sub: every 5 min, at: [1, 1], about: "Fetches new UIDs, builds the dedup key and the thread key, stores the mail as `pending`, and marks mail the user moved back." }
  p-emails:    { label: emails table, sub: "pending → triaged", at: [2, 1], kind: store, about: "The queue between sync and triage. A claim takes rows with `FOR UPDATE SKIP LOCKED`; a stale lock is taken back and counts one attempt." }
  p-triage:    { label: triage.worker, sub: every 15 s, at: [3, 1], focal: true, about: "Hard rules first, then the classifier, then the pure planner and policy. It writes the action rows as `ready`, `awaiting_approval` or `logged` in its own transaction, under the settings version." }
  p-actions:   { label: actions table, sub: "ready, awaiting, applied", at: [4, 1], kind: store, about: "One row per planned change with an idempotency key, attempts and a lock. The status map lives in `transitions.ts` and a test compares it with the guards." }
  p-tg:        { label: Telegram, at: [3, 2], kind: external, about: "The owner sees the recipient, the full draft and the quoted original, then taps Send or Reject. Only an owner can approve." }
  p-committer: { label: actions.committer, sub: every 15 s, at: [4, 2], about: "Claims `ready` and `approved` rows per mailbox, opens one IMAP connection, applies idempotent changes with the ensure rule and sends at most once." }
edges:
  - p-sync => p-mail: reads
  - p-sync -> p-emails: stores
  - p-emails -> p-triage: claim
  - p-triage => p-llm: classify
  - p-triage -> p-actions
  - p-actions -> p-committer: claim ready
  - p-committer => p-mail: move, send
  - p-actions ~> p-notifier: awaiting approval
  - p-notifier => p-tg: card
  - p-tg --> p-actions
notes:
  - on: p-triage
    text: "The policy decides inside the triage transaction. There is no separate gate job and no planned status."
  - on: p-committer
    text: "A move first locates the mail by identity in both folders, so a crash between the IMAP call and the commit is safe to repeat."
  - on: p-tg->p-actions
    text: "The tap is a conditional update, awaiting to approved. A second tap finds the status changed and answers with it."
caveat: "The returned job, the chaser, the expiry job, retention and the digest are left out. They follow the same claim pattern."
```

## 04 · The life of an action row

```figure
id: action-states
layout: states
title: actions.status, the send path and the idempotent path
grid: [5, 3]
nodes:
  s-awaiting: { label: awaiting_approval, at: [0, 0], about: "A send waits here after its draft is applied and the card went out. Only an owner's tap moves it on." }
  s-approved: { label: approved, at: [1, 0], about: "The tap wrote `approved_at`, `approved_by` and `approved_via`. The committer claims it only within 48 h and under `SEND_SCOPE`." }
  s-applying: { label: applying, at: [2, 0], about: "Committed before a non-idempotent call: a draft APPEND or an SMTP send. After a crash the next run searches the folder before it tries again." }
  s-applied:  { label: applied, at: [3, 0], about: "The provider result, the audit row and `applied_at` were written in one transaction. For a send, right after the SMTP 250." }
  s-undone:   { label: undone, at: [4, 0], about: "The user tapped Undo or moved the mail back. A reverse row restored the mailbox; the original keeps its history." }
  s-ready:    { label: ready, at: [0, 1], about: "The policy said apply. Moves, flags and mark-read go straight to applied, because the ensure rule makes them safe to repeat." }
  s-expired:  { label: expired, at: [1, 2], about: "Nobody answered within 48 h, the draft went missing, the policy changed, or a ready row aged past 24 h. The reason is in `status_reason`." }
  s-failed:   { label: failed, at: [3, 2], about: "Three hard errors, a mail that is nowhere, or a send with an unknown outcome. The owner gets one notice; a send offers Send again." }
edges:
  - s-awaiting -> s-approved: Send tap
  - s-approved -> s-applying
  - s-applying -> s-applied: accepted
  - s-applied -> s-undone: Undo tap
  - s-ready -> s-applied: idempotent apply
  - s-ready -> s-applying: draft APPEND
  - s-applying --> s-approved: soft error
  - s-applying --> s-failed: 3 hard errors
  - s-awaiting --> s-expired: 48 h timeout
  - s-ready --> s-expired: stale 24 h
notes:
  - on: s-applying
    text: "The only status that guards a non-idempotent call. A send never retries by itself after the SMTP DATA line."
  - on: s-ready
    text: "Idempotent actions skip applying: the committer locates the mail first and repeats the change only when it is still needed."
caveat: "`rejected` and `logged` are left out, and so are the reverse rows and the Send again row. The full map is `apps/server/src/modules/actions/transitions.ts`."
```

## 05 · The foundation plan

Eight tickets run before the feature epics. [The critical path](#plan-critical) is the CI fix, the border lint, then the notice seam and the repository split. [The flags ticket](#f087) unblocks the most: every later epic ships behind a flag.

```gantt
id: plan
title: Foundation tickets, one lane each, calendar days
start: 2026-11-13
today: 2026-11-13
tasks:
  - { id: f093, label: F093 CI green, group: Gate, start: 2026-11-14, days: 1, about: "Fix the three timing tests with condition waits, add the quarantine rule, record the CI time. A red CI hides every regression of the 250 stages to come." }
  - { id: f086, label: F086 Module borders, group: Gate, after: f093, days: 1, about: "A boundary lint with layers and allowed edges, the two violations fixed, a generated module graph, the new standards in the styleguide." }
  - { id: f087, label: F087 Feature flags, group: Seams, after: f086, days: 1, focal: true, about: "Registry in core, table `org_features`, `FEATURES_OFF`, `isFeatureOn`, the operator check. Every Stage 2 behaviour ships behind one." }
  - { id: f088, label: F088 Notices as facts, group: Seams, after: f086, days: 2, about: "The outbox stores the view and a locale; a renderer registry per kind, channel and detail; a detector registry. E4-B, E7, E8b and E9b build on it." }
  - { id: f089, label: F089 Structured logs, group: Seams, after: f086, days: 1, about: "The JSON writer, allow-listed fields, run and request ids, the lint rule in warn mode. The module-by-module conversion runs later as a side lane." }
  - { id: f090, label: F090 LLM roles, group: Seams, after: f086, days: 1, about: "`generate({ role })` with a role table in config, usage per role, a prompt registry. The E2a judge and the E6 drafter need it." }
  - { id: f091, label: F091 Repo split, group: Shape, after: [f088, f090], days: 1, about: "Split `actions/repo.ts` and `mail/repo.ts` by aggregate, table-driven `apply.ts`, a completeness test per action type. No behaviour change." }
  - { id: f092, label: F092 RLS safety net, group: Shape, after: f087, days: 2, muted: true, about: "Policies on every table with `org_id`, `SET LOCAL app.org_id` per web request. Optional: waits for the owner's decision." }
  - { id: ms-early, label: "E1, E2a, E3a, E5a may start", group: Milestones, after: f087, milestone: true, about: "These epics need only the gate and the flags. They run next to the remaining seams." }
  - { id: ms-epics, label: "E4-A, E5b, E6a may start", group: Milestones, after: [f088, f091], milestone: true, about: "The panel and draft epics touch the repositories, the notices and the LLM layer, so they wait for every seam." }
notes:
  - on: f087
    text: "The smallest ticket with the widest reach: four epics are blocked only by it."
  - on: f088
    text: "The longest seam ticket. E4-B and E7-T1 wait for it, so it should start right after the gate."
caveat: "Days are one Limen lane at full speed. With two lanes the seams run in parallel; with one they add up to about nine days."
```

```matrix
id: needs
title: Which epic ticket needs which foundation ticket
corner: Foundation
columns:
  - { id: e2a, label: E2a }
  - { id: e3a, label: E3a }
  - { id: e4a, label: E4-A }
  - { id: e4b, label: E4-B }
  - { id: e5b, label: E5b }
  - { id: e6a, label: E6a }
  - { id: e7, label: E7 }
  - { id: e8, label: E8 }
  - { id: e9, label: E9 }
rows:
  - { id: n-ci, label: F093 CI green, about: "Every epic lands through CI.", cells: { e2a: yes, e3a: yes, e4a: yes, e4b: yes, e5b: yes, e6a: yes, e7: yes, e8: yes, e9: yes } }
  - { id: n-borders, label: F086 Borders, about: "New modules need the layer list before they exist.", cells: { e2a: partial, e3a: yes, e4a: yes, e4b: yes, e5b: yes, e6a: yes, e7: yes, e8: yes, e9: yes } }
  - { id: n-flags, label: F087 Flags, about: "PD-045 puts every new behaviour behind a flag.", cells: { e2a: no, e3a: yes, e4a: yes, e4b: yes, e5b: yes, e6a: yes, e7: yes, e8: partial, e9: yes } }
  - { id: n-notices, label: F088 Notices, about: "The mail channel, the Polish texts, the SLO alerts and push all render notices.", cells: { e2a: no, e3a: partial, e4a: no, e4b: yes, e5b: partial, e6a: partial, e7: yes, e8: yes, e9: yes } }
  - { id: n-logs, label: F089 Logs, about: "New log lines should be events from the first stage.", cells: { e2a: partial, e3a: partial, e4a: partial, e4b: partial, e5b: partial, e6a: partial, e7: partial, e8: yes, e9: partial } }
  - { id: n-llm, label: F090 LLM roles, about: "Judge, extractor, drafter and escalation are new roles.", cells: { e2a: yes, e3a: partial, e4a: no, e4b: no, e5b: yes, e6a: yes, e7: no, e8: no, e9: no } }
  - { id: n-split, label: F091 Repo split, about: "These tickets add functions to the two big repositories.", cells: { e2a: no, e3a: partial, e4a: yes, e4b: partial, e5b: yes, e6a: yes, e7: partial, e8: no, e9: no } }
  - { id: n-rls, label: F092 RLS, about: "Optional. New tables join the policy test when it exists.", cells: { e2a: no, e3a: partial, e4a: partial, e4b: partial, e5b: partial, e6a: partial, e7: yes, e8: no, e9: partial } }
```
