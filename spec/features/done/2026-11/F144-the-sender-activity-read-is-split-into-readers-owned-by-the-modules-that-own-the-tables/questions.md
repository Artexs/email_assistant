# F144 questions

No blocking question. Defaults taken (plan.md § Decisions taken):

1. [minor] Design: contacts reads the triage readers through a new same-layer edge contacts → triage in `layers.json`, not through a hook filled in a composition root. Undo: remove the edge and pass the two readers as parameters from `refresh.ts` and `suggest.ts` callers.
2. [minor] Scope: the other cross-module reads of the contacts module stay: the data request address list in `contacts/privacy.ts` (reads `emails`, `sent_emails`, `delegates`) and the `mailboxes` reads of the suggestion commands. Undo: a follow-up ticket with the same pattern.
3. [minor] Scope: the F100 metric readers that select `FROM emails` from triage and channels stay; the new rule in `docs/code-patterns.md` § Data access says they predate it.
