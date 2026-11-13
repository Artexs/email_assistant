---
opened: 2026-11-13
---

# F088 · Notices are stored as facts and rendered per channel, detail and locale by a renderer registry

## Outcome

A module that has something to tell the user queues `{ kind, view, locale }` and never builds channel text. The outbox sender renders the message when it sends, with the renderer for the kind, the channel and the detail level, in the user's locale. Adding a notice kind is one detector file and one renderer file, and a test fails when one is missing. E4-B (mail channel), E7 (Polish texts), E8b (SLO alerts) and E9b (push, minimal Telegram) each add a renderer instead of changing the pipeline (ADR 0032 point 5, PD-033, PD-037).

## Scope

- Starting seam: `apps/server/src/modules/channels/{notices,sender,repo}.ts`, the `outbox` table, the render functions in `packages/core/src/digest/*`.
- The outbox row gains `view jsonb`, `channel`, `locale`; `text` and `buttons` become the rendered cache written at send time.
- One renderer registry in `packages/core` keyed by kind; the Telegram renderer for every existing kind; `en` texts now, `pl` keys in E7.
- The detector registry: `channels/notices/<kind>.ts` with one `detect` each; `detectForOrg` iterates.
- The edit of an approval card after a tap renders through the same registry with the status in the view.

## Out of scope

- New channels (mail, push), new detail levels (`minimal`), Polish texts: E4-B, E9b, E7 build on this seam.
- New notice kinds (weekly report, SLO alert, replies ready): their epics.

## Acceptance

- Every `outbox.kind` has a detector and a renderer; a unit test enumerates the kind list, the detector registry and the renderer registry and fails on a gap.
- The sender renders at claim time from `view`, `channel` and `locale`; the stored `text` equals the sent text (integration test).
- A row with a `view` that its renderer rejects becomes `failed` / `bad_view`, with a log line of ids only.
- Existing Telegram texts are byte-identical for every kind: the integration tests of `channels-notices` and `channels-sender` pass unchanged except for the queue shape.
- Retention clears `view` with `text` (`clearOutboxTexts`, `docs/architecture.md` §7 row).
- `docs/code-patterns.md` has the standard "notices are facts" and the checklist "add a notice kind".

## Slices

Six stages, in order, one job each: registry in core; `[risky]` migration and repository; producers queue views; `[risky]` the sender renders; detector registry; docs. Reviews, the owner step and the checkpoint: [plan.md](plan.md) § "How to run (coordinator)".

## Sequenced

- Plan after: the module borders ticket (F086), whose plan sets the lint and the standards sections this plan builds on; it has `stages/`.
- Build after: the module borders ticket (F086) in `spec/features/done/` (`docs/product/stage-2/07-foundation-plan.md` §1 row 4).
- Gate: stage 02 never runs next to another migration stage (F087 stage 1, F092 stage 1); at most two Stage 2 tickets in build (`05-execution-plan.md` §2.4).

## Notes

Design and stages: [plan.md](plan.md). Source: review §3.4, §3.10, part of §3.3; ADR 0032, PD-033, PD-037. Open defaults: [questions.md](questions.md).
