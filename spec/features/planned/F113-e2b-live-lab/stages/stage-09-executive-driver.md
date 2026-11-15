# F113 stage 09 — executive driver `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D3, D8, D10. Risk area: sending to people (an approve tap makes the server send mail; inside the sim stack only).

## Goal

The scripted executive reads its chat in the fake Telegram, finds the slot behind each card, and presses the button that the stage 08 rules give, at the planned time, once.

## Files

`apps/server/src/modules/lab/executive.ts`; a DB reader for the card lookup in the same module (it reads `actions`, `emails` and the approval set tables of the run org, with `org_id` on every table).

## Interfaces

```ts
type ExecutiveDeps = { state: LabState; tg: FakeTelegramClient; db: Db; now: () => Date; corpus: LabCorpus };
runExecutiveTick(deps: ExecutiveDeps, runId: string): Promise<{ planned: number; pressed: number; unmapped: number; noRule: number }>;
lookupCard(db: Db, ctx: TenantContext, card: { actionId?: string; setId?: string; emailId?: string }): Promise<{ messageId: string; draft?: ExecCard["draft"]; moved?: boolean } | null>;
```

`FakeTelegramClient` is `createFakeTelegramClient(TELEGRAM_API_ROOT)` from `tools/fake-telegram/src/driver.ts`. If the module rules or the workspace forbid that import from `apps/server`, write a small client in the lab module over the fake's `/_fake/*` control routes (the same calls). Stage 05 uses the same client.

## Decisions

- **Read.** Each tick reads the run org's chat (`LabOrg.chatId`) and takes the messages after the last seen message id (a `seen` event). Cards are messages with inline buttons; `cardKindOf` gives the kind.
- **Look up.** From the callback data (`parseCallback`): the action id, set id or email id. `lookupCard` scopes every query by the run org. For an approval: the draft kind and recipient from the action payload, and the Message-ID of the action's mail. For a reminder set: no slot needed (rule 6). For feedback: the email's Message-ID and whether an automatic move out of the INBOX is `applied` and not undone.
- **Truth.** `parseLabMessageId` on the mail's Message-ID; a run id other than this run → `truth` null. The slot gives `category`, `expectedDraft` and the expected delegate's address.
- **Plan.** `executiveDecision` gives the press; `executiveTapAt` the time. Append `tap_planned` with key `<message id>:<data>`. A planned reject keeps its reason in memory; when the reason card for that action appears, rule 5 presses it.
- **Press.** When `at ≤ now`: `tap_intent`, `tg.press({ data, messageId, chatId })`, `tap_done`.
- **Resume.** `tap_intent` without `tap_done` → read the action's state in the DB (approve or reject already recorded?) or, for an Undo, the undo row. Done → `tap_done`; else press again. A second press on a decided card is harmless (the server answers "already decided"), but the test still requires one press.
- **Fake restart.** When the newest message id in the chat is lower than the last seen one, the fake lost its state: append `skip` code `fake_restarted`, reset the seen id. Approvals that wait with no card left expire; the scorer counts them.
- **Guard.** The tick refuses unless `checkSimEnv` is clean (it already ran at start; check again each serve start). It never presses in a chat other than the run org's.

## Tests (integration: job DB, fake Telegram in-process, the server's Telegram runtime as in `tools/fake-telegram/test/e2e.test.ts`)

If a case cannot drive the full runtime in one test, it may build the card with the core message builders and send it through the fake; say which in the final message.

1. A delegation approval card to the expected delegate → after the planned time one `ap:` press; the action is approved.
2. A delegation to another delegate → `ar:` press, then `rw:p:` on the reason card; the action is rejected with reason wrong person (needs `mistake_capture` on, as seed does).
3. An applied move of a mail with truth `urgent` and its card with Undo → `fu:` press; an undo starts.
4. A card for a mail whose Message-ID is not a lab id → no press, `unmapped` 1.
5. Crash: `tap_intent` written, press done by hand, no `tap_done` → the next tick presses nothing (press count stays 1 in `/_fake/callbacks`).
6. Two orgs: a card in the other org's chat is never read or pressed.
7. Fake restart (seen id above the newest id) → `skip fake_restarted`, no crash.
8. Mutation checks: drop the org filter in `lookupCard` → test 6 or a two-org lookup test fails; drop the resume check → test 5 fails. Restore both.

## Done when

Tests pass; `live-lab.md` has the executive rules; the Proof prints `PROOF_OK`. The final message lists each guard and its failing test.

## Out of scope

Draft edits (no Telegram button; the E4-A commands, F102, are a later `ActPort`). The serve loop.
