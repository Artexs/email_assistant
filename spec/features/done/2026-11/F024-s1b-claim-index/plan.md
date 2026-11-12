> **Status 2026-11-07 — done.** Done by S3 stage 2: migration `20261107000001_assist_actions.sql` adds `emails_claim_idx (mailbox_id, status, received_at)`.

# Index for the email claim query

The claim query filters `org_id`, `mailbox_id`, `status` and `next_attempt_at` / `received_at`. Only `emails_org_id_idx` helps. The worker runs every 15 s. Fine at pilot volume. Add a new migration (never edit an applied one), for example `CREATE INDEX ... ON emails (mailbox_id, status, received_at)`, before S3 or when the mailbox grows.
