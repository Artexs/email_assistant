# F062 · Questions (defaults taken, owner to confirm)

1. [minor] **Data export key names.** From the expand release on, `org:export` writes `source_uid` and `move_pending_at` for each mail and leaves out `inbox_uid`, `undo_pending_at` and the stale `mailboxes` cursor. The export `version` stays `1` (columns change with migrations already). Default: as written (plan D8). Other: export both names until the contract.
2. [important: irreversible] **No rollback past the expand release after the contract.** After the release that carries stage 05, `deploy/rollback.sh` reaches only the expand release; anything older needs a restore from the pre-release backup. Default: accept; it is the purpose of the ticket (plan D10, stage 05 S05-1). Other: keep the old columns one more release.
3. [minor] **The new columns stay nullable.** Old mail outside INBOX has no source UID. Default: nullable (plan D7). Other: a third migration with `SET NOT NULL` after a backfill rule.
4. [minor] **The test tool keeps `inboxUid`.** `mailbox:probe-move` names the UID in INBOX, which is correct for that tool. Default: keep (plan D9).
5. [minor] **Old demo seeds.** A demo seed exported before stage 01 or 02 no longer imports (`bad_seed`), because the seed keys follow the export map. Default: export the seed again; no new seed format (plan D12). Other: bump the seed format and map old keys on import.
