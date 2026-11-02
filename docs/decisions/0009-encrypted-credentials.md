# 0009 — Mail credentials encrypted in the server, never readable by clients
- Status: accepted (user, 2026-11-02)
- Date: 2026-11-01

## Context
The current `secrets` table stores credentials as plain JSONB and has an RLS SELECT policy for the owner:
a logged-in browser can read mail passwords and tokens. It also links secrets to the user, not the mailbox.

## Decision
- New table `mailbox_credentials` (one row per mailbox): encrypted secret (IMAP/SMTP password or app password, ADR 0010), secret kind, key version.
- Encryption in the server: AES-256-GCM, key from env `CREDENTIALS_KEY`, `key_version` for rotation.
- Only the server process reads the table and decrypts the secret in memory. The secret never goes to logs or to the web app.
- The old Supabase migration with the `secrets` table is removed in S0 (ADR 0011).
- On mailbox removal the row is deleted, and the user gets a notice to change the mailbox password.

## Consequences
- A DB leak or a backup leak alone does not expose passwords (backups are also encrypted).
- Key loss means all mailboxes must re-connect: store the key in a password manager / secret store.
- The secret is a full mailbox password: prefer an app password where the provider has one.
