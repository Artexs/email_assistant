---
opened: 2026-11-20
---

# F161 · A command description with a trailing newline in its usage text is refused

## Outcome

A command description with a trailing newline in its usage text is refused.

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

## Outcome

The command description check in `packages/core/src/cli/description.ts` (`cliDescriptionSchema`) refuses a usage text that ends with a newline. Today the check can never fail: it calls `trimEnd()` before `endsWith("\n")`, so the newline is already gone. A mutation run found it.

## Scope

- Fix the one condition to `!usage.endsWith("\n")`. Start at `packages/core/src/cli/description.ts` line 72.
- Add one test: a usage ending with `\n` fails the schema; one without it passes.
- Run the CLI list check (`bun run cli:list` or its test) to see that no real command has a trailing newline; fix any that has.

## Out of scope

- Other schema rules, other CLI changes.

## Acceptance

- A usage that ends with a newline fails `cliDescriptionSchema` with the message "usage has no trailing newline" (new test, exact assert).
- Breaking the condition back to the old form makes the new test fail.
- `bun run check:job` ends with PASS.
