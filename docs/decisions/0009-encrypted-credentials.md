# 0009 — Mail credentials encrypted in the server, never readable by clients
- Status: proposed
- Date: 2026-11-01

## Context
The current `secrets` table stores credentials as plain JSONB and has an RLS SELECT policy for the owner:
a logged-in browser can read mail passwords and tokens. It also links secrets to the user, not the mailbox.

## Decision
- New table `mailbox_credentials` (one row per mailbox): encrypted refresh token, key version, scopes.
- Encryption in the server: AES-256-GCM, key from env `CREDENTIALS_KEY`, `key_version` for rotation.
- RLS on, no policies: only the server reads the table.
- The old `secrets` table is dropped in the S0 migration.

## Consequences
- A DB leak alone does not expose tokens.
- Key loss means all mailboxes must re-connect: store the key in a password manager / secret store.
- Supabase Vault stays an option if the key handling moves to the DB later.
