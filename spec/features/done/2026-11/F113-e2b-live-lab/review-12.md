# F113 stage 12 review (Sonnet 5.5, PASS c492305d)

Model: Sonnet 5.5, because the stage is read-only scoring with org-scoped queries and no send path or migration. No BLOCKING, no TEST GAP.

Notes:
1. The manifest hash is the sha256 of the parsed and re-serialized manifest, not of the file bytes. A change in loader defaults or key order changes the hash for an identical file. Stage 16 docs must name the form ("sha256 of the parsed manifest").
2. The join matches `message_id_header IN (trimmed ids)`; a stored header with inner whitespace shows as `not_synced`. Same rule as the delegation finder.
3. The JSON M1 block holds `sample` (labelled 0, `missRateUpper` null) and `missesBySource` (all 0): they carry no information in the lab. Harmless; do not read them.
4. `joinRun` would emit two rows for a duplicated slot id; the planner never produces one.
5. Lint warnings (35) are not in the stage files.
