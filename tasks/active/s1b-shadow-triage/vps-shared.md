# s1b-shadow-triage — VPS stages 37–40: shared setup

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md).

## Stages 37–40 — Pilot shadow run on the VPS (blocked until 2026-11-05T23:30Z and the S1a audit check)

Preconditions for stages 37–40: `date -u` is after 2026-11-05T23:30Z; `tasks/planned/s1a-48h-audit-check.md` is done (in `tasks/done/`); stages 0–35 are committed; the stage 34 run passed (whitelist 100%, every injection case passed); user checkpoint 4 passed. Stage 36 is not a precondition. Only these stages touch the VPS. The main session runs them with the user.

Shell setup on the VPS (`ssh home_vm`, `cd ~/email_assistant`, bash): `C="docker compose -f deploy/compose.yaml --env-file .env"`. `<ORG>` and `<MB>` = the pilot org and mailbox ids in `notes/2026-11-03-pilot-vps.md`. SQL runs read-only through `$C exec -T db psql -U postgres -d email_assistant -c "<SQL>"`. The agent never prints `.env`; the user edits it.

SQL used below (replace `<MB>`; `<START>` and `<BF_START>` are UTC times from the log):

- **Q1 real mail per day:** `SELECT received_at::date AS day, count(*) FILTER (WHERE message_id_header IS NULL OR message_id_header NOT ILIKE '%@ea-seed.test>') AS real, count(*) FILTER (WHERE message_id_header ILIKE '%@ea-seed.test>') AS synthetic FROM emails WHERE mailbox_id = '<MB>' GROUP BY 1 ORDER BY 1;`
- **Q2 real mail with a triage result (must be 0 under `synthetic`):** `SELECT count(*) FROM triage_results t JOIN emails e ON e.id = t.email_id AND e.org_id = t.org_id WHERE e.mailbox_id = '<MB>' AND (e.message_id_header IS NULL OR e.message_id_header NOT ILIKE '%@ea-seed.test>');`
- **Q3 eval-case mails by status:** `SELECT status, count(*) FROM emails WHERE mailbox_id = '<MB>' AND message_id_header ILIKE '<eval-%@ea-seed.test>' GROUP BY status;`
- **Q4 LLM calls by outcome:** `SELECT reason_code, count(*) FROM audit_log WHERE event = 'llm.call' AND data->>'mailbox_id' = '<MB>' GROUP BY reason_code ORDER BY 2 DESC;`
- **QA real mails and results in the week:** `SELECT count(*) AS real_mails, count(t.email_id) AS with_result, min(t.created_at), max(t.created_at), max(t.created_at) - min(t.created_at) >= interval '7 days' AS week_ok FROM emails e LEFT JOIN triage_results t ON t.email_id = e.id AND t.org_id = e.org_id WHERE e.mailbox_id = '<MB>' AND e.created_at >= '<START>' AND (e.message_id_header IS NULL OR e.message_id_header NOT ILIKE '%@ea-seed.test>');` (`real_mails` = real mails that arrived in the week; the stage 39 trigger uses it).
- **QB real labels:** `SELECT count(DISTINCT f.email_id) AS real_labels FROM triage_feedback f JOIN emails e ON e.id = f.email_id AND e.org_id = f.org_id WHERE e.mailbox_id = '<MB>' AND (e.message_id_header IS NULL OR e.message_id_header NOT ILIKE '%@ea-seed.test>');`
- **QC old waiting mail (must be 0):** `SELECT count(*) FROM emails WHERE mailbox_id = '<MB>' AND ((status = 'pending' AND created_at < now() - interval '1 hour' AND (next_attempt_at IS NULL OR next_attempt_at <= now())) OR (status = 'processing' AND locked_at < now() - interval '10 minutes'));` (if the LLM pause is on at that moment, wait for its end and run it again).
- **QD tokens and latency stored (missing must be 0):** `SELECT count(*) FILTER (WHERE t.tokens_in IS NULL OR t.tokens_out IS NULL OR t.latency_ms IS NULL) AS missing, count(*) AS with_model FROM triage_results t JOIN emails e ON e.id = t.email_id AND e.org_id = t.org_id WHERE e.mailbox_id = '<MB>' AND t.model IS NOT NULL;`
- **QE skipped as too old:** `SELECT count(*) FROM emails WHERE mailbox_id = '<MB>' AND status = 'skipped' AND skip_reason = 'too_old';`
- **QF cursor:** `SELECT uidvalidity, last_uid FROM mailboxes WHERE id = '<MB>';`
- **QG backfilled rows:** `SELECT status, count(*), min(received_at), max(received_at), count(*) FILTER (WHERE message_id_header IS NULL OR message_id_header NOT ILIKE '%@ea-seed.test>') AS real FROM emails WHERE mailbox_id = '<MB>' AND backfilled_at IS NOT NULL GROUP BY status;`
- **QH real INBOX mail of the window, by status and label (review finding 12):** `SELECT e.status, (EXISTS (SELECT 1 FROM triage_feedback f WHERE f.email_id = e.id AND f.org_id = e.org_id)) AS labeled, count(*) FROM emails e WHERE e.mailbox_id = '<MB>' AND e.folder = 'INBOX' AND e.received_at >= timestamptz '<BF_START>' - interval '30 days' AND (e.message_id_header IS NULL OR e.message_id_header NOT ILIKE '%@ea-seed.test>') GROUP BY 1, 2 ORDER BY 1, 2;`
