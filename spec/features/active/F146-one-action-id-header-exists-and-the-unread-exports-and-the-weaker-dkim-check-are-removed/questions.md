# F146 questions (defaults taken, owner to confirm)

None blocks a stage. Each line: the default, then how to undo it.

1. [minor] `expiredFlags` stays (plan D9). The quality finding said nothing calls it; the unit test "no registry flag is past its remove-by date" calls it with the real registry in CI. Undo: a follow-up ticket deletes it and the remove-by promise.
2. [minor] Tests, fixtures and `apps/server/test/` keep the literal `X-EA-Action-Id` (plan D4), as an independent check of the wire format. Undo: widen the scan roots of `action-id-header-scan.test.ts`.
3. [minor] `tools/mail-oauth-spike/` keeps its literal header name (plan D5): a spike with no `@ea/core` dependency. Undo: add `tools/` to the scan roots and a dependency.
4. [important: scope] No general unused-export checker (plan D10): this ticket removes the known list only; a new dead export can appear again. Undo: a ticket that adds a checker (needs a `bun.lock` change).
5. [minor] The parser cases of the old DKIM check run through `hasCoveredDkimPass` with test signatures (plan D6), not through a new public helper. Undo: none needed.
