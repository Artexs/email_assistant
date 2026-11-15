# VPS deploy queue (coordinator, 2026-11-15)

VPS runs master at `b56d414b` (F101 deploy, 2026-11-15 00:20 UTC). Not live yet:
- F032 (closed `bd9eacde`): store a copy below the UID cursor. Count the new log lines `sync_below_cursor_copies_stored` and `sync_below_cursor_copy_skipped` after the deploy, into `notes/2026-11-07-assist-actions-facts.md` (F032 NV1).
- F104 stages 01–03 (migration `20261115090001_sent_mail.sql`, Sent repo, rules; no Sent sync yet: stage 04+).
- F103 stages 01–03 (CLI output; log field kinds).
- F119 stages 06–07 (SSO required refusal; provider service). Stage 15 is the F119 deploy.
- F112 stage 01 (docs workspace; server image filter): the CI `image` job proves the image.
- F128 (2FA code on disable and new codes): deploy after its re-review and land; the owner checks it in the panel.
- F109 stage 01 (core rules only).
Rule: back up first, tag `ea-server:pre-<ticket>`, deploy a CI-checked pinned commit, verify, then record here.

## Deployed 2026-11-15 05:2x UTC (batch 1)
- VPS now at `df42788b` (detached HEAD; green CI run 43679928874). Before: `b56d414b`. Rollback image `ea-server:pre-batch1115`; backup `ea-20261115T052116Z.dump.age` (470523 bytes). Roll back the code, not the migrations.
- Migrations applied: `20261115090001_sent_mail`, `20261115110001_mailbox_oauth`, `20261115120001_suspicious_urgency_sender`, `20261115130001_approval_edit`.
- Brings: F032, F104 stages 01–08 (flag `sent_sync` off: do NOT turn on before F104 stage 10), F103 stages 01–08, F119 stages 06–11 (stage 12 not in), F128, F112 stage 01, F109 stages 01–04, F117 stages 01, 03–07, F102 stages 01–08, F113 stages 01–05 (sim stack not run here).
- Checks: health 200; no error line in the first 3 minutes; 11 sync lines.
- Open: F128 owner check in the panel (turn 2FA off needs a code); F032 log lines `sync_below_cursor_copies_stored` / `_copy_skipped`: count after a few sync cycles into `notes/2026-11-07-assist-actions-facts.md`; remove `ea-server:pre-batch1115` after 24 h.
