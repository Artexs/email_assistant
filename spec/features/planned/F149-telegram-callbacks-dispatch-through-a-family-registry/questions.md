# F149 questions

1. [minor] The live lab bot (`apps/server/src/modules/lab/executive.ts`) and the simulator (`packages/core/src/sim/live/executive.ts`) keep their hand-written prefix strings (`ar:`, `rw:<code>:<id>`, `press(card, prefix)`). Default: out of scope; the frozen wire format (plan D2) keeps them valid. Option: move them to the codec in a follow-up, after the coordinator decides where the lab lives (quality pass 2, finding 12). Plan D12.
