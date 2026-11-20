---
opened: 2026-11-20
---

# F155 · The source-text regexes in main.test.ts and composition.test.ts are replaced by behaviour tests

## Outcome

Tests do not read the text of source files to check wiring. The three cases in `main.test.ts` and the three in `composition.test.ts` check behaviour instead, so a rename or a reformat no longer fails them. Owner decision (F125 gate G1, 2026-11-20): replace these regexes; the four capability-page prose pins stay.

## Scope

- `apps/server/src/main.test.ts` lines 42, 52, 61 and `composition.test.ts` lines 214, 231, 445 (find them by name; lines drift).
- A new exported function in the start code may give the seam. The server start-up now lives in `apps/server/src/start/`.
- Keep what each case guards: the wiring order and the shared context.

## Out of scope

- The capability-page tests in `replies/capability-page.test.ts`.
- The security scans in `privacy-address-pattern-use.test.ts`.
- Any change of start-up behaviour.

## Acceptance

- None of the six cases reads a source file as text.
- Each new case fails when its wiring is removed once.
- `bun test` of both files passes.
