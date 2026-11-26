Review of the F151 stage 05 candidate (commit 6d48f33c86ee46bd00c0e965ee2bf59097acd2f2), job 2026-11-26-f151-demo-setup-review-1-c4f967d1, model claude-opus-5-5.

Verdict: PASS. BLOCKING: none. TEST GAP: none.

Unverified, not blocking: both `demo:record --setup-only` runs ran on a seed built from the integration fixture, not on a real lab export (none exists in ~/.local/share/email-assistant/demo/). Run the stage proof once on a trial export (C1a).

NOTE:
- Stage test 2 input in the stage file is wrong (offsets 4d1h vs 2d1h). The code uses 2026-11-25T08:00Z as first date and is correct.
- Stage 06 must call `deliverToB(mailboxB, messages)` (two arguments), not the one-argument form of the stage interface.
- `runDemoSetup` also turns open_loops and reply_drafts off with org-flag.ts --off. Accepted.
- Setup files import server module internals directly (test code; lint does not apply).
- /tmp/f151-s05/seed-auto.json (synthetic) was not deleted.
- Possible race: an autonomy_paused notice sent after the @setup read would not be seen; stage 06 recording would show it.
