# Stage 01 results: per-function gap tool and mutation run lock

## Probe on the audit run

`bun scripts/test-audit/mutation-gaps.ts --in /tmp/f125-s03/run-4/mutation.json --min 5 --by fn`: 122 rows, 1,260 counted mutants (survived plus no coverage). The file was present. Top rows: `replies/schema.ts` (module level) 42, `sim/checks.ts` `checkSpread` 38, `sim/sent-slot.ts` (module level) 33, `digest/approvals.ts` `renderApprovalRequest` 29, `triage/suspicious.ts` `isOneEditApart` 29.

## Lock check

- `flock /tmp/email-assistant-mutation.lock sleep 30` held in one shell; `bash scripts/test-audit/mutation.sh /tmp/f154-s01/one --mutate 'src/web/csp.ts'` in another printed `mutation.sh: waiting for the mutation lock` and wrote `mutation.json` after the hold ended (42.5 s wall time including the wait).
- Without a held lock: `mutation.sh /tmp/f154-s01/two --mutate 'src/web/csp.ts'` took 12.7 s wall time (`csp.ts`: 118 killed, 8 survived, 6 no coverage).
- Not run: the 2-hour timeout path (exit 3).

## Notes

- Mutant columns in the report are 1-based; the tool converts them to offsets.
- `repoPath` is now exported from `mutation-summary.ts` (no behaviour change).
- The compare tables list functions whose before or after count is at least `--min` (default 1).
