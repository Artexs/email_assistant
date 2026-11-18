# F118 plan review 1 — fixes

Part of [plan.md](plan.md). One line per finding of [plan-review-1.md](plan-review-1.md). All 21 findings fixed; none rejected.

| Finding | Fix |
| --- | --- |
| B1 cascade deletes rows; `no_device` cannot hold | D3: `session_id` FK SET NULL (null = ended). D4: `outbox.push_subscription_id` FK SET NULL, indexed, CHECK only `IS NULL OR channel = 'push'`. D9: `removeDevice` fails open rows `no_device`, then deletes. Stage 02 tests 1–3 and repo tests 2–4; stage 08 tests 2 and 6. |
| B2 burst of old pushes on a new device | D20: `eventAt` (required for push kinds); a push row only for devices with `created_at ≤ eventAt`. Stage 07 tests 7–8. |
| B3 push-only owner and the loop-consent gate | D21: the gate is Telegram-only; `only: "telegram"` for `loop_consent`, `only: "push"` for the real kind. Stage 07 step 2 tests 6–7. |
| B4 `/status` vs Q4 | D12 and stage 09: `/status` in `minimal` names "Mailbox 1…"; test 3 changed. |
| B5 interfaces before their stage | `noticeGroups`, `pushKinds`, `noticeGroupOf` move to stage 04; `"push"` channel and the optional renderer key move to stage 07. `interfaces.md` updated. |
| T1 readers of the Telegram dedup key | D22 and new stage 08b step 1: card fail, F079 seen check, `sync_ok` episodes; the worker lists every other reader. |
| T2 sent payload not checked | Stage 08 test 1 decrypts the body (stage 01 test helper `test/push-decrypt.ts`). |
| T3 loss after queue | D23 and stage 08b step 2: `no_device` falls back to the Telegram row; Q7 updated. |
| T4 push-only orgs not visited | D8 and stage 07 step 2: `detectNotices` visits them; test 1 runs through `detectNotices`. M5/SLO stays Telegram (Q11). |
| N1 suspended rows | D10 and stage 08: rows of a suspended org are not claimed; the `outdated` step is gone. |
| N2 `listLiveDevices` needs a box | Split: `listLiveDeviceIds` (no secret) for the fan-out, `loadDeviceSecret` for the sender. |
| N3 wrong registry; papers late | Stage 01: no `OUTSIDE_CALL_CLASSES` entry; stop and ask if a registry change moves the legal digest. Q12 and gate G-papers: `web_push` only for the owner's org until stage 13. |
| N4 G-flag vs O2 | G-flag: no deploy between the lands of 07 and 08. |
| N5 CSP | D15 and stage 04: `worker-src 'self'` and `manifest-src 'self'` explicit. |
| N6 consent version | D13 and stage 13: `tg_consent_text` and `TELEGRAM_CONSENT_VERSION` do not change. |
| N7 index | Stage 02: index on `outbox.push_subscription_id`. |
| N8 send-time SSRF check | D19 and stage 01: `sendWebPush` runs `checkPushEndpoint` first; test 8. |
| N9 old full-card taps | D12: accepted on purpose (the text is already in that chat). |
| N10 `reply_result` | Stage 06 test 8: no group, Telegram only. |
| N11 shared browser | D16, stages 02, 03, 05: the load-time PUT is `rebindOnly`; a new device needs the click. Stage 03 test 8. |
| N12 word counts | `plan.md` § Planning progress lists them. |
