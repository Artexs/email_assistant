# Capability map

> Agent-facing reference of what the system does now: one page per capability, with rules, entry points, data, limits and decisions. It is not on the public docs site (PD-100). The user docs are in `apps/docs/`.

## Rules

- A landed feature updates its capability page in the same change (PD-009). A landed user-visible feature also updates its user doc page (en) in `apps/docs/src/content/docs/` in the same change (PD-100; `docs/code-patterns.md` § Docs site).
- A page states the code at the commit on its "Checked against" line. Plans and gaps go only to "Limits", with the ticket folder or F-number.
- Behaviour detail lives here. `docs/architecture.md` keeps goals, context, layout, module rules, ports, invariants, data model, security and deployment, and links here.
- A new capability adds a page and an index row in the same change.
- `apps/server/src/capability-map.test.ts` checks the pages: the index, the headings, the "Checked against" line, every repo path, every `bun run` script and every ADR number.

## Page template

```markdown
# <Title>

> Checked against the code at `<sha>`, YYYY-MM-DD.

## What it does now

<3–8 sentences, user and operator view. Only behaviour that the code at the checked commit has.>

## Rules

<Numbered behaviour rules (condition → result). Text moved from `docs/architecture.md` keeps its wording.>

## Entry points

<One table `| Kind | Name | Where |`. Kinds: job, CLI, route, Telegram, function, page. "Where" is a repo-root path in backticks, without a line number.>

## Data

<Tables and columns the capability writes; its status flows.>

## Limits

<What it does not do now, known gaps, and the ticket or epic that changes it (F-number or bare folder name, never a lane path).>

## Decisions

<ADR links (`ADR NNNN`) and PD rows.>

## Tests

<The main test files (repo-root paths).>
```

## Pages

| Page                                           | Capability         | Main modules                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [sync.md](sync.md)                             | Sync               | `modules/mail`, `packages/core/src/mail`                                                                                                                                                                                                                                                 |
| [sent-mail.md](sent-mail.md)                   | Sent mail          | `modules/mail` (`sent-sync.ts`, `sent-texts.ts`, `sent-rules.ts`, `repo/sent-*.ts`), `modules/actions` (`sentOriginOf`)                                                                                                                                                                  |
| [open-loops.md](open-loops.md)                 | Open loops         | `modules/loops`, `packages/core/src/loops`, `modules/channels` (`consent.ts`, `loop-taps.ts`, `delegate-taps.ts`), `apps/web/src/components/loops`                                                                                                                                       |
| [sender-context.md](sender-context.md)         | Sender context     | `modules/contacts`, `packages/core/src/contacts`, `platform/crypto.ts` (`senderKeyHash`), `modules/loops` (`analyze-write.ts`), `modules/triage` (`suspicious-context.ts`, `prompts/classifier-v4.ts`), `apps/web/src/components/rules/SuggestionsCard.tsx`                              |
| [triage.md](triage.md)                         | Triage             | `modules/triage`, `modules/config` (rules), `packages/core/src/triage`, `platform/llm`                                                                                                                                                                                                   |
| [trust.md](trust.md)                           | Trust ladder       | `modules/trust`, `packages/core/src/trust`, `modules/triage` (`evidence.ts`, `classify-stored.ts`, `review-*.ts`, `newsletter-*.ts`), `modules/channels` (`notices/trust.ts`, `report-mail-sender.ts`, `notify-settings.ts`), `apps/web` (`report`, `review`, the trust cards)           |
| [actions-and-undo.md](actions-and-undo.md)     | Actions and Undo   | `modules/actions`, `modules/triage` (`returned.ts`, `undo.ts`), `modules/config` (settings), `packages/core/src/triage`                                                                                                                                                                  |
| [drafts-and-send.md](drafts-and-send.md)       | Drafts and send    | `modules/actions` (`drafts.ts`, `send.ts` and its parts `send-*.ts`, `approvals.ts`, `expiry.ts`), `modules/mail/imap/smtp.ts`, `packages/core/src/outgoing`, `packages/core/src/digest/approvals.ts`                                                                                    |
| [reply-drafts.md](reply-drafts.md)             | Reply drafts       | `modules/replies`, `packages/core/src/replies`, `modules/actions` (`reply-pass.ts`, `copy.ts`, `copy-check.ts`, `lifetime.ts`, `close.ts`, `replace.ts`), `modules/channels` (`reply-*.ts`, `notices/replies-ready.ts`, `notices/reply-results.ts`), `apps/web/src/components/approvals` |
| [delegation.md](delegation.md)                 | Delegation         | `modules/delegation`, `modules/triage/service.ts`, `packages/core/src/triage/planners.ts`                                                                                                                                                                                                |
| [digest-and-notices.md](digest-and-notices.md) | Digest and notices | `modules/channels`, `modules/reports` (`digest.ts`), `packages/core/src/digest`, `packages/core/src/notices`                                                                                                                                                                             |
| [measurement.md](measurement.md)               | Measurement        | `modules/reports` (`metrics.ts`), `packages/core/src/metrics`, the metric readers of `triage`, `actions`, `delegation`, `audit`, `channels`                                                                                                                                              |
| [web-panel.md](web-panel.md)                   | Web panel          | `apps/web`, `web.ts`, `platform/http.ts`, `platform/auth.ts`, the `routes.ts` of each module                                                                                                                                                                                             |
| [tenancy-and-plans.md](tenancy-and-plans.md)   | Tenancy and plans  | `modules/tenancy`, `packages/core/src/tenancy.ts`, `packages/core/src/features.ts`, `platform/http.ts` (`requireTenant`, `requireOwner`, `requireOperator`), the `org-*.ts` scripts                                                                                                      |
| [account-data.md](account-data.md)             | Account data       | `modules/privacy`, `apps/server/src/scripts/org-delete.ts`, `org-export.ts`, `org-dsr.ts`, `platform/crypto.ts` (`dsrAddressHash`), `db/migrations/20261114160001_account_data.sql`, the delete block of the Account card                                                                |
| [retention.md](retention.md)                   | Retention          | `retention.ts`, the `clear*` functions of `modules/mail`, `modules/triage`, `modules/actions`, `modules/delegation` and `modules/channels`                                                                                                                                               |
| [backups.md](backups.md)                       | Backups            | `deploy/backup.sh`, `deploy/restore-test.sh`, `deploy/restore.sh`, `deploy/README.md`                                                                                                                                                                                                    |
| [operations.md](operations.md)                 | Operations         | `modules/operator` (`slo-job.ts`, `slo-checks.ts`, `alerts-repo.ts`), `packages/core/src/ops`, `scripts/ops-alert*.ts`, `apps/server/src/scripts/credentials-check.ts`, `deploy/restore.sh`                                                                                              |
| [live-lab.md](live-lab.md)                     | Live lab           | `modules/lab`, `scripts/lab*.ts`, `packages/core/src/sim/live`, `platform/eval-ledger.ts`                                                                                                                                                                                                |
| [logs.md](logs.md)                             | Logs               | `platform/log.ts`, `platform/log-fields.ts`, `platform/cli.ts`, `platform/errors.ts`, `eslint.config.js`                                                                                                                                                                                 |
| [papers.md](papers.md)                         | Papers             | `apps/web/src/legal`, `apps/web/src/pages/legal`, `packages/core/src/legal`, `docs/legal`, `docs/cost-model.md`, `packages/core/src/metrics/cost-model.ts`                                                                                                                               |
