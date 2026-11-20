---
opened: 2026-11-13
---

# F122 · An owner gets a writing style suggested from their own sent mail

## Outcome

An owner taps "Suggest my style from my sent mail" on the style card of a mailbox. The assistant reads up to 100 of their own sent mails of the last 14 days once, writes a short style description with no names, contacts or quotes, and the owner edits it and saves it as the writing style of reply drafts. It ships behind its own flag and turns on only if a judged eval shows that drafts with the suggested style fit the user's style better, with no loss on facts. The old organization signature field goes away in a contract step, after its text moved to each mailbox.

## Scope

- One-shot style suggestion from the sent text that sent-mail tracking already stores (epic `docs/product/stage-2/epics/E06-reply-drafts.md` decision 11, PD-080).
- The new LLM role, its prompt, its code checks, the owner route and the style-card button.
- The eval: a suggester run on the simulated sent mail, a paired drafter run with and without the style, a style-aware judge version, and the gate file.
- The contract step of PD-079: stop using `organizations.style_text`, then drop it in a later release.

## Out of scope

- A change of the reply drafter prompt (drafts stay skeletons, `drafter-v4`).
- Learning from draft edits (Stage 3) and sent mails as examples in any prompt.
- A stored copy of the suggestion or of the sent texts it read.

## Acceptance

- With both flags on and sent tracking on, the owner route answers a suggestion that passes `checkStyleSuggestion`; nothing new is stored but one audit row and the `llm.call` rows.
- A member gets 403; either flag off gives 404; sent tracking off gives 409 `sent_off`.
- The style card fills the writing-style field from "Use this text" and saves only on Save.
- `organizations.style_text` is gone from the schema and the code; existing mailboxes keep the copied signature.
- The gate run records a verdict in `tuning-1.md` (with `evals/results/gate/stylist-*.json` when the holdout runs ran), and its spend is ≤ $1.00.
- Detail: `plan.md` § Done when.

## Slices

Ten stages, one worker job each: `plan.md` § Stages and § How to run. Stages 04 and 05 hold the migrations; 05 waits for the release that carries 04.

## Sequenced

- Plan after: F115 (reply drafts; its `stages/` and `interfaces.md` exist).
- Build after: F115 E6a and F104 E5a in `done/` (row 28 of `docs/product/stage-2/05-execution-plan.md` §2.1).
- Gate: the judge-gain gate is stage 09; the flag `style_from_sent` turns on only after it passes (owner, 2026-11-20).

## Notes

Source row: §2.1 # 28. Defaults: `questions.md`.
