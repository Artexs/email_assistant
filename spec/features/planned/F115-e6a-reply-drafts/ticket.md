---
opened: 2026-11-13
---

# F115 · Mail that needs a reply gets a checked draft that waits for one tap

## Outcome

Mail that needs a reply gets a checked draft in its thread, in the mailbox's style, and the draft waits for one owner tap. The system never sends a draft that the user changed in the mail client, never deletes such a draft, and never answers a mail twice. This is Stage 2 row 21 (`docs/product/stage-2/05-execution-plan.md` §2.1); the owner decided the product in the epic `docs/product/stage-2/epics/E06-reply-drafts.md` (PD-070–PD-084, ADR 0033).

## Scope

- The drafter: an LLM call under code checks, with gaps for missing facts; a prototype run on the `needs_reply` holdout with the reply judge and a reply injection set.
- The draft kind `reply`: reply quote, threading, a display name, signature and writing style per mailbox; a 7-day life; it closes when the mail is answered, a newer mail arrives in the thread, or the original moves.
- Mail-client edit safety for every draft kind (PD-076).
- Telegram: a "replies ready" notice, review one draft at a time, Redraft by a reply text, Reply all, Draft reply on tap. Panel: the reply kind on the approvals page, a style card, sample drafts in shadow mode. The flag and the mailbox switch `reply_drafts`; outcome counts.

## Out of scope

- Style from Sent mail (E6b, F122), learning from draft edits, auto-send, meeting slots, chat corrections beyond one instruction line.
- Telegram detail levels (ADR 0032, E9b F118), reply drafts on Graph or Gmail (E9), the E4-B report page (F110) beyond the sample-draft function that it links.

## Acceptance

- The holdout report `evals/results/*-drafter-v1-reply.md` exists and shows code checks and judge scores; the reply injection report passes 100%.
- An integration test: a `needs_reply` mail in `assist` with the switch on gets one `reply` draft in Drafts with `In-Reply-To`; a second mail in the thread closes the first draft.
- An integration test: an approved send whose Drafts copy changed ends `draft_changed`, no SMTP call, and the copy stays.
- An integration test: an approved reply whose mail was answered in Sent ends `answered`, no SMTP call.
- `approve` of a version that holds `[[` answers `has_gaps`.
- Stage 18: three real replies sent from drafts on the pilot mailbox (owner step O1).

## Slices

One worker job per stage, in order 01 → 18 (`plan.md` § Stages and § How to run). Stage 03 is the only migration. Gate G1 (second pass) after stage 02. Owner checkpoints C1 (after 09) and C2 (after 15) and owner step O1 (stage 18) do not stop the build.

## Sequenced

- Plan after: F102 (panel approvals: supersede, API, page), F104 (Sent readers and switch), F109 (the suspicious-mail reader), F103 (event log lines), F111 (endpoint in LLM call rows), F106 (data-request address map). Each has `stages/`.
- Build after: F097 (offline lab), F100 (measure), F102, F104, F099 (flags, send limits) in `spec/features/done/`; F109 stage 04 landed. Stages 01–02 need only F097 in `done/`; they may build earlier.
- Gate: G1, the second pass after stage 02 (PD-071, PD-072 model, PD-083), before stage 03.

## Notes

Detail: `plan.md`, `interfaces.md`, `stages/`. Defaults for the owner: `questions.md`. Scout packets: `scouts.md`. PD-076 replaces F043.
