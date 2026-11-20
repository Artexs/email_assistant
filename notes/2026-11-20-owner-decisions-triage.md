# Owner decisions triage (2026-11-20)

Source: `docs/owner-decisions.md`, 157 entries marked `new` (842 lines).
Counts by kind: privacy 20, scope 16, user-visible 13, security 10, rule-exception 7, production 7, process 7, product 6, money 9 (incl. quota), ops 3, quality 2, irreversible 2.
Many "new" entries are old (2026-11-14/15) and later work built on them.

## Priority 1: read now (hard to undo, or user/legal exposure)
- Irreversible: F097 feedback source "review", down migration deletes rows (2026-11-14). F062 after the contract release, rollback reaches only the expand release (2026-11-20).
- Security: F119 SSO client secret stored in clear in `sso_providers`; SSO asks no TOTP; F107 breach notice 24 h; F105 two-factor defaults; F099 production deploy and operator id; F117 OAuth token memory; F110 one-click unsubscribe (DKIM not checked); F115 long numbers blocked in drafts.
- Production: F118 push needs your phone (checkpoint A); F118 push sessions end after 12 h; F114 release v0.2.0 deployed; F104 `sent_sync` flag waits for a time budget; F112 GitHub Pages stays off.
- Privacy that conflicts with the text users see: F110 privacy page says "no mail older than 7 days" but the history check sends 30-day mail; F110 page does not name the unsubscribe request; F118 push sends ids and counts to FCM before the papers name them; F116 mail-body addresses go to the model; F098 Polish consent text is an agent draft; F107 legal drafts name no company or person.
- Money: F113 production key in the sim lab ($1/$5 caps); F109 gate spend caps; F119 Entra tenant about 7 USD/month; F110 history check $0.25 cap.

## Priority 2: decide soon (rule exceptions, behaviour you will see)
- Rule exceptions (7): F097/F100 build while F095 open; F100 starts despite drift; F138 plan defaults; F115 stage 02 judge-v3 replaces judge-v2 and the blind holdout was used a second time (weakens the gate, check this); F124 one weaker assertion and max_connections 200; test scripts `--timeout=30000`.
- User-visible (13): Telegram language rules, `minimal` push level, no Reject button at minimal level, sender line only in panel, Telegram texts no longer say "in the panel", every legal text change forces new terms acceptance.
- Scope calls that shape the product: F141 one `LLM_PROVIDER` and DeepSeek refused for real mail; F138 dropped; F117 dropped; F105 two-factor stays off; F109 phishing flag stays off, v3 prompt and escalation cascade not shipped.

## Priority 3: skim or mark `ok` in bulk
- Process (7), product (6), ops (3), quality (2): harness model choices, tab/ticket housekeeping, small text and retention choices.
- The 2026-11-20 F125, F143, F147, F148, F153 CLI/lint/test defaults: technical, each has an Undo line. Mark `ok` unless you disagree.

## Suggested next step
Read the 2 irreversible, then the privacy-text mismatches (F110, F118), then the F115 holdout reuse. Mark the rest `ok`.
