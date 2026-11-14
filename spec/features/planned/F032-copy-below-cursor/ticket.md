---
opened: 2026-11-07
---

# F032 · Store and triage a copy that lands below the UID cursor

## Outcome

S3 stage 6 only logs and counts a copy that lands below the UID cursor. Interia may keep the UID on a COPY back to INBOX. The sync then does not see the mail as new. Store such a copy as `#n` and triage it: body fetch and the chunk insert path.

## Notes

Moved from `tasks/planned/copy-below-cursor.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).

## Sequenced

- Plan after: F029 (its plan: spec/features/planned/F029-sync-return-of-a-later-copy/plan.md, D1 and § Overlap with F032 and F062).
- Build after: F029.
- Gate: —.
