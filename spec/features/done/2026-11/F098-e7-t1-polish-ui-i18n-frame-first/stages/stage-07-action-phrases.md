# F098 stage 07 — The action phrases in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P7, D9, D10, D11. Needs stage 06 landed. Review job before the land (new Polish texts). One step.

After this stage "what the system does or would do" comes from `packages/core/src/texts/would-do.ts` in both languages. The hold still gives English to everyone.

## Step 1 — The action phrases

**Goal.** "What the system does or would do" in both languages, without English word order in Polish (D11).

**Files.** `packages/core/src/digest/would-do.ts` (+ `would-do.test.ts`), new `packages/core/src/texts/would-do.ts`, `packages/core/src/texts/index.ts` (`CoreTexts.wouldDo`), the callers that `bun run typecheck` lists (`notices/renderers.ts`, `reports/activity.ts`, `reports/digest.ts`, `would-do.test.ts`, `digest.test.ts`).

**Interfaces.**

```ts
// texts/would-do.ts
export type ActionTense = "would" | "will" | "done" | "undone" | "failed";
export type SendPhraseStatus = "logged" | "awaiting_approval" | "approved" | "applying" | "applied" | "rejected" | "expired" | "failed";
// DraftKind exists on master in packages/core/src/triage/payloads.ts (one list of draft kinds, from the repository split
// ticket F091). Import it; never declare a second DraftKind (two `export *` of one name fail typecheck with TS2308).
import type { DraftKind } from "../triage/payloads";
export interface WouldDoTexts {
  tense: Record<ActionTense, string>;
  flag: (tense: ActionTense) => string;
  markRead: (tense: ActionTense) => string;
  move: (tense: ActionTense, folder: string | null) => string;
  draft: (tense: ActionTense, kind: DraftKind, name: string | null) => string;
  send: Record<SendPhraseStatus, string>;
  staysIn: (folder: string) => string;
}
```

`would-do.ts` keeps the status → tense maps (`TENSES`, `DRAFT_TENSES`) but their values become `ActionTense` keys (`logged` → `would`; `ready`, `applying`, `awaiting_approval`, `approved` → `will`; `applied` → `done`; `undone` → `undone`; `failed` → `failed`). The composition stays: groups by tense in first-seen order, `${texts.wouldDo.tense[tense]} ${phrases.join(", ")}`, sends after the groups, no phrase twice in a row, parts joined with `"; "`. A draft whose `kind` is null uses `"delegation"`. Signatures:

```ts
export function describeAction(action: WouldDoAction, names: ReadonlyMap<string, string>, texts: CoreTexts): string | null;
export function describeActions(actions: readonly WouldDoAction[], names: ReadonlyMap<string, string>, opts: { stayFolder?: string }, texts: CoreTexts): string;
```

(No defaults: every caller passes all four.) The folder in `move` is `MOVE_TARGET_NAMES[folder]` (an IMAP folder name, plan P7); `staysIn` gets `opts.stayFolder` cut to 30 characters or `"INBOX"`.

Text tables (copy word for word):

| Entry | en (today's output) | pl |
| --- | --- | --- |
| `tense` | would · will · done: · undone: · failed: | zrobiłby: · zrobi: · zrobione: · cofnięte: · nieudane: |
| `flag(t)` | flag | would, will: "oznaczyć flagą"; done, undone, failed: "oznaczenie flagą" |
| `markRead(t)` | mark read | would, will: "oznaczyć jako przeczytaną"; else "oznaczenie jako przeczytanej" |
| `move(t, null)` | move | would, will: "przenieść"; else "przeniesienie" |
| `move(t, f)` | `move to ${f}` | would, will: `przenieść do ${f}`; else `przeniesienie do ${f}` |
| `draft(t, "clarification", _)` | draft a question to the sender | would, will: "przygotować szkic pytania do nadawcy"; else "szkic pytania do nadawcy" |
| `draft(t, "reminder", n)` | `draft a reminder to ${n ?? "a delegate"}` | would, will: `przygotować szkic przypomnienia` + (n ? ` (wykonawca: ${n})` : ""); else `szkic przypomnienia` + the same suffix |
| `draft(t, "delegation", n)` | `draft a delegation to ${n ?? "a delegate"}` | would, will: `przygotować szkic zlecenia` + (n ? ` (wykonawca: ${n})` : ""); else `szkic zlecenia` + the same suffix |
| `send` | logged "would ask you to send it", awaiting_approval "waits for your approval", approved "approved, sending", applying "sending", applied "sent", rejected "rejected", expired "not sent (approval expired)", failed "not sent (failed)" | "poprosiłby Cię o wysłanie", "czeka na Twoje zatwierdzenie", "zatwierdzone, wysyłanie", "wysyłanie", "wysłane", "odrzucone", "niewysłane (zatwierdzenie wygasło)", "niewysłane (błąd)" |
| `staysIn(f)` | `stays in ${f}` | `zostaje w ${f}` |

The name in parentheses avoids a Polish case ending on a name we cannot decline.

**Decisions.** D11.

**Test.** `would-do.test.ts`: every old case gets `textTables.en` and keeps its expected text (byte-identical). New `pl` cases (`names = new Map([["d1", "Jan"]])`):

1. One `move` `logged` to the folder key `ai_info` (`MOVE_TARGET_NAMES.ai_info` is `"AI/Info"`, `packages/core/src/triage/planners.ts`) → `"zrobiłby: przenieść do AI/Info"`.
2. `move` `applied` to `ai_info` + `flag` `applied` → `"zrobione: przeniesienie do AI/Info, oznaczenie flagą"`.
3. `create_draft` `ready` kind `delegation` delegate `d1` → `"zrobi: przygotować szkic zlecenia (wykonawca: Jan)"`; delegate unknown → `"zrobi: przygotować szkic zlecenia"`.
4. `send` `awaiting_approval` → `"czeka na Twoje zatwierdzenie"`.
5. No actions, `stayFolder` undefined → `"zostaje w INBOX"`.
6. `describeAction` of a `mark_read` `failed` → `"nieudane: oznaczenie jako przeczytanej"`.

**Check.** `bun test packages/core/src`; `bun run typecheck`; `bun test apps/server/test/integration/reports-activity.test.ts apps/server/test/integration/reports-digest.test.ts apps/server/test/integration/channels-notices.test.ts`.

**Done when.** Cases 1–6 pass; old cases pass unchanged except the argument.

**Out of scope.** Panel phrases per request locale (stage 13).

## Stage done when

- Step 1 is done.
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 07) prints `PROOF_OK`.
