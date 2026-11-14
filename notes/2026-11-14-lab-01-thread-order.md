# lab-01: thread entries in 16 cases do not match the slot order

Found by F097 stage 20 (step 1 extra check b), 2026-11-14.

## Rule

`slot.thread[i].persona` is the sender of `text.thread[i]`. Order is oldest first
(`packages/core/src/sim/slot.ts`, `evals/sim/README.md` step 3). `toEvalCase`
(`packages/core/src/sim/to-eval-case.ts`) gives `text.thread[i]` the sender
address of `slot.thread[i]` and the time `receivedAt - (n - i) h`. A swapped entry
gets the wrong sender and the wrong time in the eval case. `sim check`, `reconcile` and
`stale` do not detect it (`checkCase` compares only the count).

## Result

Threaded slots (kept, with text thread): 252 (dev 60, holdout 192). Week has none:
week replies use the parent chain. 236 cases match. 16 do not.

Mismatch type A: text is newest first, slot is oldest first (text entries reversed):
dev b-urg-0140, b-urg-0180, h-rnt-02, h-rnt-03 (all 3 entries), h-rnt-07;
holdout b-del-0256, b-inf-0100, b-inf-0112, b-inf-0189, b-inf-0216, b-inf-0221, b-inf-0230.

Mismatch type B: text is oldest first, but the slot lists the executive first:
dev b-rep-0095, h-dmd-06; holdout b-urg-0102.

Mismatch type C: holdout b-inf-0010. The slot names `koordynator-sprzedazy`; the one text
entry is the executive's reply (signed Wiktor Szalewski).

Method: the author of each entry read from the sign-off; the executive (E) or other (O)
pattern of the slot compared with the pattern of the text (`threads4.ts`); the 16 read in full;
non-executive entries also compared by sign-off name (`threads5.ts`: no other mismatch).

## Fix (not done in stage 20)

Reorder `text.thread` to the slot order for type A; for type B and C the planner slot or the
text must change (slots are plan output: do not edit by hand). Each change alters the blind
file, so `sim stale` flags the case and stage 19 must label it again. Then freeze.
