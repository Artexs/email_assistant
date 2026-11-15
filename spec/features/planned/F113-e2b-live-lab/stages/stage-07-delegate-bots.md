# F113 stage 07 — delegate bots `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D8, D9, D11. Risk area: exactly-once and sending (bot mail goes into the sim pipeline).

## Goal

Each delegate of the scenario reads its GreenMail inbox and answers the assistant's delegation mail the way its slot plans: `done`, `late`, `out_of_office`, `other_address` or `silent`.

## Files

`packages/core/src/sim/live/bot.ts` (pure plan and texts), `apps/server/src/modules/lab/bots.ts` (IMAP and SMTP through `LabMailClient`, stage 06).

## Interfaces

```ts
type BotEvent = "delegation" | "reminder";
type BotReplyPlan = { kind: "done" | "auto_reply"; from: "self" | "other"; at: string };
botReplyPlan(input: { behaviour: DelegateBehaviour; event: BotEvent; receivedAt: string; repliedBefore: boolean; seed: number }): BotReplyPlan | null;
botReplyText(kind: "done" | "auto_reply", lang: "pl" | "en" | "de", name: string, backOn: string): { subject: string; body: string };
otherAddressOf(address: string): string;   // "dorota.wilczynska@poczta-prywatna.test"
runDelegateBotsTick(deps: BotDeps, runId: string): Promise<{ planned: number; sent: number; unmapped: number; unexpected: number }>;
```

## Decisions

- **Read.** Per delegate address, fetch INBOX mail after the last seen UID (a `seen` event per address). Skip mail from bot addresses.
- **Classify.** A mail from the run mailbox is a `reminder` when its `In-Reply-To` or `References` holds the Message-ID of a delegation mail this bot got before; else a `delegation`.
- **Map.** Look for a lab Message-ID of this run in `References` (`parseLabMessageId`). Its slot gives `delegateBehaviour`. No lab id → `skip` code `unmapped`, no reply. A slot without `delegateBehaviour`, or whose `expectedDelegate` is another persona → `skip` code `unexpected_delegation`, no reply (the delegate stays silent; the scorer counts it for M3).
- **Plan** (`botReplyPlan`, times in Warsaw):
  - `done`: on `delegation`, `at` = the next working time (weekdays 08:00–18:00) plus 30–240 min. On `reminder`: null.
  - `late`: on `delegation`: null. On the first `reminder` with `repliedBefore` false: `done` at the next working time plus 30–120 min.
  - `out_of_office`: on each event, `auto_reply` at receipt plus 1 min, any hour.
  - `other_address`: like `done`, `from: "other"`.
  - `silent`: always null.
  - Seed = a hash of run id and the received Message-ID, so a replay plans the same times.
- **Send.** Append `bot_planned` with key `<received Message-ID>:<kind>`. When `at ≤ now`: `bot_intent`, SMTP, `bot_done`. From = the delegate address, or `otherAddressOf` for `other`. To = the `From` of the received mail. Subject `Re: <subject>` (or the auto-reply subject). `In-Reply-To` = the received Message-ID; `References` = its `References` plus that id. Message-ID `<r.<first 12 hex of sha256(key)>@<sender domain>>`.
- **Auto-reply headers.** `Auto-Submitted: auto-replied`; the body says the person is out until `backOn` (receipt date plus 7 days).
- **Resume.** `bot_intent` without `bot_done` → `hasMessageId` in the run mailbox INBOX; found → `bot_done`, else send.
- **Texts.** Fixed templates per language (persona `lang`), no LLM: pl "Zrobione. Pozdrawiam, <name>", en "Done. Best regards, <name>", de "Erledigt. Viele Grüße, <name>"; auto-reply pl "Jestem poza biurem do <date>. Odpowiem po powrocie.", en "I am out of the office until <date>. I will answer when I am back.", de "Ich bin bis <date> nicht im Büro. Ich antworte nach meiner Rückkehr." These are persona texts, not product texts.
- `allowedAddresses` of stage 02 includes the three `otherAddressOf` values.

## Tests

Unit (`botReplyPlan`, fixed seed):
1. `done`, delegation Mon 2026-11-23 10:00 Warsaw → `at` within [10:30, 14:00] the same day.
2. `done`, delegation Fri 17:50 → `at` on Mon from 08:30.
3. `late`: delegation → null; first reminder → `done`; second reminder after a reply → null.
4. `out_of_office`: delegation at Sat 03:00 → `auto_reply` at 03:01.
5. `silent`: both events → null.

Integration (shared GreenMail, random addresses, fake clock):
6. `done`: a delegation mail threaded to a lab id → one reply in the run mailbox INBOX at its time, from the delegate, with the threading headers.
7. `other_address`: the reply is from `otherAddressOf(delegate)`.
8. `out_of_office`: delegation plus reminder → two auto-replies with `Auto-Submitted`, no `done` reply.
9. Crash: `bot_intent` written, reply delivered by hand, no `bot_done` → the tick sends nothing new.
10. A mail with no lab id → `unmapped`, no reply. A slot of category `info` → `unexpected`, no reply.
11. Mutation check: drop the resume check → test 9 fails. Restore.

## Done when

Tests pass; `live-lab.md` has the five behaviours; the Proof prints `PROOF_OK`. The final message lists each guard and its failing test.

## Out of scope

Executive taps (stages 08–09). A "not mine" answer (questions.md Q4).
