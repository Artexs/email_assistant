# F086 stage 01 — `ExpireFilter` moves to core; `config` stops importing `actions`

Part of [`../plan.md`](../plan.md). Decisions: D3. One step.

## Step 1 — Move the shape

**Goal.** `config/service.ts` no longer imports `../actions`. This removes the only cross-module cycle (`mail → config → actions → mail`; plan § Facts, P2). No behaviour change.

**Files.**

- New: `packages/core/src/triage/expire-filter.ts`.
- `packages/core/src/triage/index.ts` (one export line).
- `apps/server/src/modules/actions/repo.ts` (remove the interface at line 1022, import the type from core).
- `apps/server/src/modules/actions/expire.ts` (line 11: import the type from core).
- `apps/server/src/modules/actions/index.ts` (line 88: the re-export moves to core).
- `apps/server/src/modules/config/service.ts` (line 19: import from core).

**Interfaces.**

New file `packages/core/src/triage/expire-filter.ts`, exactly this shape (the fields and their types do not change):

```ts
import type { MailboxActionType } from "./planners";

// Which `ready` original actions of one mailbox an expire closes. It lives in core so that `config`
// (the settings setters) and `actions` share it without an import between the two modules.
export interface ExpireFilter {
  mailboxId: string;
  emailId?: string;
  types: readonly MailboxActionType[];
  // The category of the newest triage_results row of the mail.
  category?: { is: string } | { not: string };
  // Also close the `awaiting_approval` sends of the mailbox and their drafts: `expireReady` does it.
  sends?: true;
}
```

- `packages/core/src/triage/index.ts`: add `export * from "./expire-filter";` in alphabetical order (after `./eval-case`).
- `actions/repo.ts`: delete the `ExpireFilter` interface and its comment lines (1022–1031). Add `type ExpireFilter` to the existing `@ea/core` import block at the top. `expireReadyOriginals` keeps its signature.
- `actions/expire.ts`: line 1 becomes `import type { ActionType, ExpireFilter } from "@ea/core";`; line 11 loses `, type ExpireFilter`.
- `actions/index.ts`: remove `ExpireFilter,` from the `export type { … } from "./repo"` list. Add `export type { ExpireFilter } from "@ea/core";` directly after the line `export { MAILBOX_ACTION_TYPES, type MailboxActionType } from "@ea/core";` (D3: `actions` re-exports it for its callers).
- `config/service.ts`: delete `import type { ExpireFilter } from "../actions";` and add `type ExpireFilter` to the `@ea/core` import block at the top (keep the names sorted as the block has them).

**Decisions.** D3. The comment in the new file has no bare codes (the old one had `S4 D13, D33`; plan § Rules for every stage).

**Test.** No new test: the type is structural and the change is a move.

1. `bun run typecheck` passes (every user of the type still compiles).
2. `bun test packages/core/src/triage apps/server/src/modules` passes.
3. `grep -rn 'from "../actions"' apps/server/src/modules/config/` prints nothing.
4. `grep -rn "ExpireFilter" apps/server/src packages/core/src` shows the type in `expire-filter.ts` and imports or re-exports of it only; no second `interface ExpireFilter`.

**Check.**

```
mkdir -p /tmp/f086-s01
bunx madge@8.0.0 --circular --extensions ts --ts-config apps/server/tsconfig.json apps/server/src > /tmp/f086-s01/madge.log 2>&1
awk '/^[0-9]+\)/ { line = $0; n = 0; split("", seen); while (match(line, /modules\/[a-z]+\//)) { m = substr(line, RSTART, RLENGTH); if (!(m in seen)) { seen[m] = 1; n++ } line = substr(line, RSTART + RLENGTH) } if (n > 1) print }' /tmp/f086-s01/madge.log > /tmp/f086-s01/madge-cross.log
wc -l < /tmp/f086-s01/madge-cross.log
git status --short bun.lock
```

- madge exits 1 (it still finds the 9 cycles inside one module; plan § Facts P2). That is expected; the log is the evidence.
- `wc -l` prints `0`: no cycle crosses two module folders. Before this stage the same filter prints `9`.
- `git status --short bun.lock` prints nothing.

**Done when.**

- Tests 1–4 hold and the madge filter prints `0`.
- Final message quotes the line count of `/tmp/f086-s01/madge-cross.log` and the number of cycles in `/tmp/f086-s01/madge.log` (expected 9).
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `01`).

**Out of scope.** The `actions → delegation/repo` import (stage 02). The cycles inside one module. Other bare codes in `actions/repo.ts`.
