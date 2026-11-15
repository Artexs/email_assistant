# F114 questions (defaults taken; owner to confirm)

No blocking question. Each item names the decision in `plan.md` that holds the default.

1. **[important: rule-exception] Alert state table without `org_id`.** `spec/vision.md`: "every table carries `org_id`". The alert state is host-wide (disk, backup have no organization) and holds numbers only. Default: `ops_alerts` without `org_id`, like `auth_lockouts` (D1). Option: an `org_id` column for the per-org kinds only (two shapes for one table).
2. **[important: production] Every VPS deploy becomes a release.** After stage 09, the coordinator deploys only through `deploy/release.sh <tag>`: a batch deploy is a patch release (`release:prepare`, commit, tag, push the tag). Default: yes (stage 06, D11). Option: keep untagged deploys next to releases (the rollback target is then unclear).
3. **[important: scope] The restore drill runs on the VPS, not on a clean VM on the owner's PC** (E8 decision 9 said a clean VM). The PC has no VM tool and jobs have no Docker there; the job instruction allows a VPS drill in a separate stack. The drill uses project `ea-drill`, its own volume, image, network and no port; the `age` key stays on the PC; the plain dump goes over ssh. It does not time a Docker install on a bare host. Default: VPS (D17). Option: a later drill on a clean VM.
4. **[important: security] No version on `/health`.** Default: the release name is in every log line and in the container env, not on the public route (D10).
5. **[important: production] The drill copies `CREDENTIALS_KEY` from the live `.env` on the VPS** (into a mode-600 file that the drill deletes). So the drill does not prove the owner's password-manager copy. Default: copy from the live file (stage 07). Option: the owner types the key from the password manager during the drill.
6. **[important: production] No automatic rollback in `release.sh`.** A failed step prints the rollback command; the coordinator runs it (D12).
7. **[minor] Alert texts in English,** like the other operator notices (D5).
8. **[minor] One incident per kind,** not per mailbox (D2).
9. **[minor] `ops_alerts` rows are kept** (no retention; a few rows per incident) (stage 01).
10. **[minor] The urgent alert counts only mail that the urgent notice would cover** (linked chat, not junk, triaged after the link and after a resume), and counts only minutes outside quiet hours (stage 02, review 1 N1–N3).
11. **[minor] First version `v0.1.0`** (D14).
12. **[minor] `ops:alert-test --all` sends five TEST messages to the operator group** in stage 09 (the owner sees them; U4).
