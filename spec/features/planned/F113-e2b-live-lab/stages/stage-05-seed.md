# F113 stage 05 — seed the lab organization

Part of [`../plan.md`](../plan.md). Decisions D3, D15, D18.

## Goal

`bun run lab seed` makes the lab organization of the sim stack from `scenario.json`, once. A second call checks it and changes nothing.

## Files

`apps/server/src/modules/lab/seed.ts`, the `seed` command in `scripts/lab.ts`.

## Interfaces

```ts
type SeedTarget = { key: LabOrgKey; orgName: string; mailbox: string; mode: "shadow" | "assist" };
seedLabOrg(deps: SeedDeps, scenario: Scenario, target: SeedTarget): Promise<{ org: LabOrg; created: boolean }>;
LAB_TARGETS: Record<LabOrgKey, SeedTarget>;
// lab  → "Kordelan lab",  wiktor.szalewski@kordelan.test,       assist
// demo → "Kordelan demo", wiktor.szalewski@demo.kordelan.test,  shadow
```

Stage 13 calls `seedLabOrg` with `LAB_TARGETS.demo`.

## Decisions

- Call the module functions that the CLIs use (`org:create`, `mailbox:connect`, `delegates:add`, `rules:add`, `mailbox:settings mode`, `telegram:link`). Do not start CLI processes.
- Organization: the target name; the owner user = the executive address and display name; plan `active`; time zone Europe/Warsaw.
- Mailbox: the target address on host `greenmail`, IMAP 3143 and SMTP 3025 (plain, as in dev), password `greenmail-test` (GreenMail with auth off; not a secret).
- Delegates: one per `scenario.delegates` entry: the persona's display name and address, the tags.
- Sender rules: one `vip` rule per `scenario.urgency.vip` persona address, on the mailbox.
- Mode: the target mode with the default switches of that mode (as `mailbox:settings mode` without `--keep-switches`).
- Urgency profile: only when a per-mailbox store exists at your commit (the E3b ticket F109 adds it). Then add `storeRunUrgencyProfile(deps, org, plan)` and call it from `start` (stage 04 command): topics as in the scenario, deadlines = `plan.deadlines` (shifted). If no store exists, add nothing and write "no urgency store" in the final message and on the capability page (Limits).
- Telegram: make a link token with the `telegram:link` function, then send `/start <token>` as the user through the fake driver client (`createFakeTelegramClient`, chat id 5550001 for lab, 5550002 for demo). Wait up to 60 s for the server to link the chat. On timeout: exit 1 `telegram_link_timeout`; the org stays, and the next `seed` tries the link again.
- Idempotent: when `orgs.json` names the key and the organization exists, check mailbox, delegates, rules and link, add what is missing, and print `seed: exists` plus the added counts. When `orgs.json` names an org id that is gone: exit 1 `org_gone` (the operator removes the entry by hand; no automatic re-create).
- `orgs.json` is written after the mailbox exists, before the Telegram step, so a crash in the Telegram step does not make a second organization.
- Output: org id, mailbox id, counts. No password.

## Tests (integration: job DB, shared GreenMail with a random mailbox address, fake Telegram in-process)

A test target uses a random address; `LAB_TARGETS` values are checked only in test 6.

1. First seed → `created: true`; 1 organization, 1 mailbox, 3 delegates with their tags, 2 `vip` rules, mode `assist`.
2. Second seed → `created: false`; the row counts of test 1 are the same.
3. Delete one delegate between the seeds → the second seed adds it back (counts 3).
4. `orgs.json` names a deleted org id → exit 1 `org_gone`; no new organization.
5. Telegram link: after seed, the chat is linked to the organization (the same check `telegram:check` uses). When the link step runs no Telegram runtime, it fails with `telegram_link_timeout` after the timeout (use a short test timeout).
6. `LAB_TARGETS.demo.mailbox` ends in `.test` and differs from the lab mailbox.
7. Tenant: a second org made by another test is not changed by seed.

## Check

`bun run test:int` for the new test file, then the Proof.

## Done when

Tests pass; `live-lab.md` has the seed rule and the CLI row; the Proof prints `PROOF_OK`.

## Out of scope

Mail, runs, demo reset.
