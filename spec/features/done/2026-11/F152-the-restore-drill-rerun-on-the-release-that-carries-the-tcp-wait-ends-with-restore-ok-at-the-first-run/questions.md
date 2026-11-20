# F152 questions

No blocking question. Defaults taken, owner to confirm:

1. **[minor] Clone tag when the live stack runs a release older than `v0.4.2`** (only after a rollback). Default: no drill; record "no release carries the wait" and wait for the next release (D1). Other option: drill at `v0.4.3` against a dump of the older schema.
2. **[minor] Time window and disk floor for the drill.** Default: not between 03:00 and 04:00 host time (backup cron at 03:30); at least 5 GB free on `/` before the start (D3). The first drill had 18 GB free.
3. **[minor] Include the optional test hardening of the F139 review as stage 02.** Default: yes, a small test-only worker stage (D8). Other option: drop it; F139-1 already covers the drill target.
