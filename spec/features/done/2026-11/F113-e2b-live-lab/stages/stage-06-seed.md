# F113 stage 06 — seed the lab organization

Part of [`../plan.md`](../plan.md). Decisions D3, D15, D18.

## Goal

`bun run lab seed` makes the lab organization from `scenario.json`, once; a second call only repairs.

## Files

`apps/server/src/modules/lab/seed.ts`, the `seed` command in `scripts/lab.ts`.

## Interfaces

```ts
type SeedTarget = { key: LabOrgKey; orgName: string; mailbox: string; mode: "shadow" | "assist" };
seedLabOrg(deps: SeedDeps, scenario: Scenario, target: SeedTarget): Promise<{ org: LabOrg; created: boolean }>;
LAB_TARGETS: Record<LabOrgKey, SeedTarget>;   // lab: "Kordelan lab", assist; demo: "Kordelan demo", shadow; mailboxes from LAB_MAILBOXES
type FakeTgClient = { send(chatId: number, text: string): Promise<void>; read(chatId: number): Promise<FakeMessage[]>; press(chatId: number, messageId: number, data: string): Promise<void>; hasChat(chatId: number): Promise<boolean> };
createFakeTgClient(apiRoot: string): FakeTgClient;   // over the fake's /_fake/* control routes
```

Stage 14 calls `seedLabOrg` for both keys. `FakeTgClient` lives in the lab module and talks HTTP to the fake's control routes; `apps/server` does not import `tools/fake-telegram` (no new workspace dependency, no `bun.lock` change; review N2). Stage 10 uses it too.

## Decisions

- Call the module functions behind `org:create`, `mailbox:connect`, `delegates:add`, `rules:add`, `mailbox:settings mode`, `telegram:link`; no CLI processes.
- Organization: the target name; the owner user = the executive address and display name; plan `active`; time zone Europe/Warsaw.
- Mailbox: the target address on host `greenmail`, IMAP 3143 and SMTP 3025 (plain, as in dev), password `greenmail-test` (GreenMail with auth off; not a secret).
- Delegates: one per `scenario.delegates` entry: the persona's display name and address, the tags.
- Sender rules: one `vip` rule per `scenario.urgency.vip` persona address, on the mailbox.
- Mode: the target mode with the default switches of that mode (as `mailbox:settings mode` without `--keep-switches`).
- Flags: lists `LAB_FLAGS_ON` and `LAB_FLAGS_OFF` hold every key of `packages/core/src/features.ts`. Off: `org_delete`, `sso_sign_in`; on: all others (the executive needs `mistake_capture`). Seed turns the on-list on. A test fails when a key is in neither list.
- Urgency profile: only when a per-mailbox store exists at your commit (E3b, F109): add `storeRunUrgencyProfile(deps, org, plan)`, called by `start` (stage 05), with `plan.deadlines`. Else add nothing and write "no urgency store" in the final message and under Limits.
- Telegram: make a link token with the `telegram:link` function, then send `/start <token>` as the user through `FakeTgClient` (chat id 5550001 for lab, 5550002 for demo). Wait up to 60 s for the server to link the chat. On timeout: exit 1 `telegram_link_timeout`; the org stays, and the next `seed` tries the link again.
- Idempotent: when `orgs.json` names the key and the organization exists, check mailbox, delegates, rules and link, add what is missing. The link check covers the fake too: when the DB link exists but the fake has no chat (`hasChat` false, after a fake restart), send `/help` from that chat so the fake knows it again (review T4). Then and print `seed: exists` plus the added counts. An org id in `orgs.json` that is gone → exit 1 `org_gone` (no automatic re-create).
- `orgs.json` is written after the mailbox exists, before the Telegram step (a crash there makes no second organization).
- Output: ids and counts.

## Tests (integration: job DB, shared GreenMail with a random mailbox address, fake Telegram in-process)

A test target uses a random address.

1. First seed → `created: true`; 1 organization, 1 mailbox, 3 delegates with their tags, 2 `vip` rules, mode `assist`.
2. Second seed → `created: false`; the row counts of test 1 are the same.
3. Delete one delegate between the seeds → the second seed adds it back (counts 3).
4. `orgs.json` names a deleted org id → exit 1 `org_gone`; no new organization.
5. After seed the chat is linked (the `telegram:check` rule); with no Telegram runtime → `telegram_link_timeout` (short test timeout).
6. Fake restart: a new fake instance (no chats), DB link kept → a second seed makes `hasChat(5550001)` true and sends no `/start`.
7. Tenant: a second org made by another test is not changed by seed.
8. After seed each `LAB_FLAGS_ON` flag is on, `org_delete` off; the list test fails with a fake extra key.

## Done when

Tests pass; `live-lab.md` has the seed rule and the CLI row; the Proof prints `PROOF_OK`.

## Out of scope

Mail, runs, demo reset.
