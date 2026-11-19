# F120 stage 11: classifier-v4 `profile` part (2026-11-19)

Result: no dev win. `profile` stays out of the production prompt (PD-107). Summary and numbers: `evals/results/2026-11-19-f120-v4-dev-summary.md`; run reports in `evals/results/f120-v4-dev/`. No holdout run, no gate file, pointer unchanged (`classifier-v2`).

## Seams a later agent needs

- `classifier-v4` (`apps/server/src/modules/triage/prompts/classifier-v4.ts`) reuses the v3 builders. `renderUserPrompt` in `classifier-v3.ts` takes the lines of the one sender block; v3 passes the history block, v4 the profile block. Without `profile`, v4 equals v3 byte for byte (unit test 4).
- Part universe: `prompts/parts.ts` (`classifierParts` = v3 parts + `profile`, `optionalParts`, `isV3Part`). `ClassifierPart` replaces `ClassifierV3Part` in the eval and registry types. `versionHasParts` says which versions carry a part list (v3, v4).
- `ClassifierExtras.senderProfile` is a whole `SenderHistory`. `eval-extras.ts` passes the sim case's story; `loadClassifierExtras` calls `readProfile` only with part `profile`, no suspicious reason, and a sender address.
- `senderProfileReader` in `composition.ts` wires `readProfile` (flag `sender_context` first, then contacts `readProfiles`). `main.ts` passes it to the triage job. The history check (`trust/history-classify.ts`) does not pass it: if the pointer ever moves to a prompt with `profile`, wire it there too, or the history check classifies without the profile.
- Eval cost of the part: about 130 input tokens per mail more than v3[list].

## Why it lost (observed, cause not proven)

- On the sim, `list` already removes the `spam` false positives; the profile adds no further `K` gain (P2 13.5 against 14.0). P1 against v2 got worse (24.5 against 23.0), with 4 more `needs_reply` false positives.
- Guess: the sim persona story (relation, answered) tells the model little that the mail text does not, and the dominant misses are `urgent` mails with no keyword (urgent FN 12 to 16 in every run).
