# F113 stage 10 — executive driver `[risky]`

Part of [`../plan.md`](../plan.md). The executive reads its fake Telegram chat, finds the slot behind each card, and presses the stage 09 button at its time, at most once. Decisions D3, D8, D10. Risk: sending (an approve tap makes the sim server send). Review 1: B2, T2, T4, T8, N6.

## Files

`apps/server/src/modules/lab/executive.ts` and its card lookup (`org_id` on every table).

## Interfaces

```ts
type ExecutiveDeps = { state: LabState; tg: FakeTgClient; db: Db; now: () => Date; corpus: LabCorpus };
runExecutiveTick(deps: ExecutiveDeps, runId: string): Promise<{ planned: number; pressed: number; unmapped: number; noRule: number }>;
lookupCard(db: Db, ctx: TenantContext, card: { actionId?: string; setId?: string; emailId?: string }): Promise<{ messageId: string; draft?: ExecCard["draft"]; moved?: boolean } | null>;
```

`FakeTgClient`: stage 06.

## Decisions

- **Read.** Each tick reads the run org's chat (`LabOrg.chatId`) after the last seen message id (a `seen` event; at run start, the newest id, so old cards are never read; review N6). `cardsOf` splits each message into cards.
- **Look up.** From the callback data (`parseCallback`): the action id, set id or email id. For an approval: the draft kind and recipient from the action payload, and the Message-ID of the action's mail. For feedback: the email's Message-ID and whether an automatic move out of the INBOX is `applied` and not undone.
- **Truth.** `parseLabMessageId` on the mail's Message-ID; a run id other than this run → `truth` null. The slot gives `category`, `expectedDraft` and the expected delegate's address.
- **Plan.** `executiveDecision` gives the press; `executiveTapAt` the time. Append `tap_planned` with key `<message id>:<data>` and `then` (`p` or `n`) for a reject. After the `ar:` press the next tick re-reads **that same message id**: the server edits it into the reason card in place (B2). Rule 5 presses `rw:<then>:<id>` from the stored `then` (survives a restart).
- **Press.** When `at ≤ now`: `tap_intent`, `tg.press({ data, messageId, chatId })`, `tap_done`.
- **Resume, at most once** (review T8): `tap_intent` without `tap_done` → no second press of any kind (`ap:`, `ar:`, `rw:`, `as:`, `ag:`, `fu:`); append `skip tap_unsure`. The report shows the lost tap.
- **Fake restart** (review T4): `hasChat` false, or the newest id below the last seen one → `skip fake_restarted`, reset the seen id to the newest; `lab seed` repairs the chat (stage 06). Approvals with no card left expire; the scorer counts them.
- **Guard.** It never presses in a chat other than the run org's.

## Tests (integration: job DB, fake Telegram in-process, the server's Telegram runtime as in the fake's e2e test)

A case may build its card with the core message builders instead; say which.

1. Delegation to the expected delegate → one `ap:` press at its time; the action is approved.
2. A delegation to another delegate → `ar:`, then `rw:p:` on the same message after its edit; the action is rejected with reason wrong person (`mistake_capture` on). A restart between the two presses still presses `rw:p:`.
3. An applied move of a mail with truth `urgent` and its card with Undo → `fu:` press; an undo starts.
4. A card for a non-lab mail → no press, `unmapped` 1.
5. Crash: `tap_intent` written, no `tap_done` → the next tick presses nothing and writes `skip tap_unsure`.
5b. A digest message with feedback buttons for 3 mails, one a wrong move of an `urgent` mail → one `fu:` press for that mail only.
6. Two orgs: a card in the other org's chat is never read or pressed.
7. Fake restart (seen id above the newest id, or no chat) → `skip fake_restarted`, no crash.
7b. Cards older than the run start are never pressed.
8. Mutation checks: drop the org filter in `lookupCard` → test 6 fails; drop the at-most-once check → test 5 fails. Restore.

## Done when

Tests pass; `live-lab.md` has the executive rules; `PROOF_OK`; the final message lists each guard and its failing test.

## Out of scope

Draft edits (a later seam for the E4-A commands, F102). The serve loop.
