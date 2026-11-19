# F113 stage 08 — delegate bots `[risky]`

Part of [`../plan.md`](../plan.md). Each delegate answers delegation mail the way its slot plans. Decisions D8, D9, D11. Risk: exactly-once, sending. Review 1: B3, N6, N13.

## Files

`packages/core/src/sim/live/bot.ts` (pure), `apps/server/src/modules/lab/bots.ts` (through `LabMailClient`, stage 07).

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

- **Read.** Per delegate address: INBOX mail after the last seen UID (a `seen` event; at run start, the newest UID, so older mail is never read; review N6). Skip mail from bot addresses.
- **Classify.** Mail from the run mailbox that references a delegation mail this bot got before is a `reminder`; else a `delegation`.
- **Map.** The lab Message-ID in `References` (`parseLabMessageId`) gives run and slot. Another run's id → ignore, no event (N6). No lab id → `skip unmapped`. A slot whose sender is this delegate persona → `skip reply_to_own_mail` (a clarification, N13). A slot without `delegateBehaviour`, or whose `expectedDelegate` is another persona → `skip unexpected_delegation`. No reply in these cases.
- **Plan** (`botReplyPlan`, times in Warsaw):
  - Start point = receipt time inside working hours (weekdays 08:00–18:00), else the next working start; the reply may fall after 18:00.
  - `done`: on `delegation`, `at` = start point plus 30–240 min. On `reminder`: null.
  - `late`: on `delegation`: null. On the first `reminder` with `repliedBefore` false: `done` at start point plus 30–120 min.
  - `out_of_office`: on each event, `auto_reply` at receipt plus 1 min, any hour.
  - `other_address`: like `done`, `from: "other"`.
  - `silent`: always null.
  - Seed = a hash of run id and received Message-ID.
- **Send.** Append `bot_planned` with key `<received Message-ID>:<kind>`. When `at ≤ now`: `bot_intent`, SMTP, `bot_done`. From = the delegate address, or `otherAddressOf` for `other`. To = the `From` of the received mail. Subject `Re: <subject>`; `In-Reply-To` = the received id; `References` = its `References` plus that id. Message-ID `<r.<first 12 hex of sha256(key)>@<sender domain>>`.
- **Auto-reply.** Header `Auto-Submitted: auto-replied`; `backOn` = receipt date plus 7 days.
- **Resume.** `bot_intent` without `bot_done` → `hasMessageId` over every folder of the run mailbox (B3): found → `bot_done`; else send.
- **Texts.** Fixed templates per language (persona `lang`), no LLM: pl "Zrobione. Pozdrawiam, <name>", en "Done. Best regards, <name>", de "Erledigt. Viele Grüße, <name>"; auto-reply pl "Jestem poza biurem do <date>. Odpowiem po powrocie.", en "I am out of the office until <date>. I will answer when I am back.", de "Ich bin bis <date> nicht im Büro. Ich antworte nach meiner Rückkehr."
- `labAddresses` (stage 04) adds the `otherAddressOf` values; add its test here.

## Tests

Unit, fixed seed:
1. `done`, delegation Mon 2026-11-23 10:00 Warsaw → `at` within [10:30, 14:00] the same day.
2. `done`, delegation Fri 17:50 → `at` within [18:20, 21:50] Friday; Fri 18:30 → Mon [08:30, 12:00].
3. `late`: delegation → null; first reminder → `done`; second reminder after a reply → null.
4. `out_of_office`: delegation at Sat 03:00 → `auto_reply` at 03:01.
5. `silent`: both events → null.

Integration (shared GreenMail, random addresses):
6. `done`: one reply at its time, from the delegate, with the threading headers.
7. `other_address`: the reply is from `otherAddressOf(delegate)`.
8. `out_of_office`: delegation plus reminder → two auto-replies with `Auto-Submitted`, no `done` reply.
9. Crash: `bot_intent`, reply delivered by hand, no `bot_done` → nothing new sent.
10. No lab id → `unmapped`; a slot of category `info` → `unexpected`; a reply to the delegate's own mail → `reply_to_own_mail`; another run's id → no event; no reply in all.
11. Mutation check: search only the INBOX in the resume check, with the reply moved to `Notifications` → a second reply. Restore.

## Done when

Tests pass; `live-lab.md` has the behaviours; `PROOF_OK`; the final message lists each guard and its failing test.

## Out of scope

Executive taps. A "not mine" answer (Q4).
