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
