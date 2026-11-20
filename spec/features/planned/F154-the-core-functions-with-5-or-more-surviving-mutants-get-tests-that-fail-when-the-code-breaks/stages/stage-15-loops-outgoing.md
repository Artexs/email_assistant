# F154 stage 15 — open loops and outgoing mail

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–14, 16, 17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `loops/brief.ts` | `oldestFirst` | 7 |
| `loops/extractor.ts` | `normalizeAnswer` | 8 |
| `loops/replies.ts` | `messageIdsOf`, `isAutoReply` | 9, 6 |
| `outgoing/message.ts` | `buildOutgoingMessage`, `uniqueIds` | 10, 6 |
| `outgoing/report-mail.ts` | `isLinkOfBase` | 5 |
| `outgoing/sender.ts` | `approvalViewOf` | 13 |

Mutate globs: `src/loops/brief.ts`, `src/loops/extractor.ts`, `src/loops/replies.ts`, `src/outgoing/message.ts`, `src/outgoing/report-mail.ts`, `src/outgoing/sender.ts`.

## Cases (fixed values)

1. `oldestFirst`: three loops with ages 3, 1, 2 days → order 3, 2, 1; two loops of the same age → ordered by id (`"a"` before `"b"`).
2. `normalizeAnswer`: each branch of the model answer shape at `HEAD` (the `if` the mutants hit), with the exact normalized value; an invalid answer → the code's fallback.
3. `messageIdsOf`: `"<a@x> <b@y>"` → `["<a@x>", "<b@y>"]`; an empty or missing header → `[]`; text with no brackets → the code's result at `HEAD`.
4. `isAutoReply`: `Auto-Submitted: auto-replied` → `true`; `Auto-Submitted: no` → `false`; each other header the function reads (`X-Autoreply`, `Precedence: bulk` or as the code lists) → `true`; no header → `false`.
5. `buildOutgoingMessage`: a reply with `In-Reply-To` and `References` → the exact headers; no parent → none of them; the subject prefix branch the mutants hit → exact subject.
6. `uniqueIds`: `["<a@x>", "<a@x>", "<b@y>"]` → `["<a@x>", "<b@y>"]`; an empty id is dropped.
7. `isLinkOfBase`: base `https://app.example` and `https://app.example/` → both accept `https://app.example/r/1`; `https://app.example.evil/r/1` → refused; `http://app.example/r/1` → refused.
8. `approvalViewOf`: a send action with each branch the mutants hit (the `if` on the payload kind) → the exact view; an empty field → the `""` vs value branch.

## Done when

- `results/stage-15.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The committer and SMTP code in `apps/server`.
