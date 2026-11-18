# F118 questions, owner steps and gates

Part of [plan.md](plan.md). None of these blocks the plan. Each has a default that the stages use. The coordinator copies the `[important]` items to `docs/owner-decisions.md` when it lands the plan.

## Questions (default, owner to confirm)

- **Q1** `[important: scope]` PD-093 says "E9b stage 1 sends a real push from Bun to the owner's phone". The phone can subscribe only on a page of our panel with our VAPID key, so the real push moves to checkpoint A after stage 05. Stage 01 proves the crypto with the RFC 8291 example. **Default:** checkpoint A after stage 05; if it fails, F118 stops before the routing stages.
- **Q2** `[important: user-visible]` Which notices can go by push? **Default (D6):** three groups: Urgent mail (urgent, not triaged), Approvals (approval, approval set, replies ready), Updates (send results, delegation answers, send held, action failed, mailbox and sync problems, Sent missing, mailbox removed). The digest, weekly report and trust reports stay on Telegram and mail (PD-033). Updates default to Telegram; Urgent and Approvals default to both once a device exists.
- **Q3** `[important: user-visible]` A device is bound to its session (PD-094). Company sign-in (SSO) sessions end after 12 h, so an SSO user gets no push after that until they open the panel again (each panel load re-binds the device). A password session lasts 30 days from the last use. A held push of an ended device falls back to Telegram when the user has a chat (D23). **Default:** accept, and say it in the device card help and the capability page. Alternative: bind to the user and remove only on explicit sign-out (weaker than PD-094).
- **Q4** `[important: privacy]` `minimal` leaves out every string of the notice, also the user's own mailbox address and delegate names; `/review` in Telegram answers with a panel link only. **Default:** yes (strict and testable: no view string at all).
- **Q5** `[minor]` The org lock does not change the members' stored levels; while it is on, everyone gets `minimal`; on unlock, members who chose `full` get `full` again. **Default:** yes.
- **Q6** `[important: security]` Push endpoints come from the browser. **Default (D19):** only `https` hosts under `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com`; any other host is refused. A new browser vendor needs a code change.
- **Q7** `[important: user-visible]` When the chosen channel does not exist (route "Phone" but no device, or "Telegram" but no chat), the notice goes to the other channel if it exists; a push that fails `no_device` later falls back to Telegram (D23). **Default:** yes. A push-only user whose only device ends loses that notice (nothing to fall back to).
- **Q8** `[minor]` At most 10 devices per user; the 11th removes the oldest. **Default:** yes.
- **Q9** `[minor]` Urgent push opens `/activity?category=urgent`, not one mail (there is no mail page, and the mail id does not go into the payload). **Default:** yes.
- **Q10** `[minor]` Payload language: the payload holds `lang` (`pl` or `en`), so the service worker shows the text in the user's language. **Default:** yes; `lang` is not mail data.
- **Q11** `[minor]` The M5 metric and the urgent-latency SLO keep counting Telegram rows only; an org with only push users is outside the alert. **Default:** yes for F118; a later ticket can add push to M5.
- **Q12** `[important: privacy]` Real push data (encrypted ids and counts) reaches FCM from checkpoint A, but the papers name the push services only in stage 13. **Default:** `web_push` stays on only for the owner's own pilot org (the owner is the only user) until stage 13 lands.

## Owner steps

- **O1** (before checkpoint A) Run `bun run push:keys` on the VPS (or a trusted machine) and put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<owner address>` into the VPS `.env`. No agent reads or prints these keys. Coordinator default if the owner is not available: wait; nothing after stage 05 needs the keys in CI.
- **O2** Deploy the build with stages 01–05; turn the flag `web_push` on for the owner's pilot organization only (G-papers).
- **O3** On the Android phone (Tailscale on): open the panel, install it, Settings → Account → "Turn on notices on this device", then "Send a test notice". Pass: the notice shows within 30 s, the tap opens the panel.
- **O4** (checkpoint B) Deploy the build with stages 01–13 and 08b; turn on `telegram_minimal` for the pilot organization (the owner's chat keeps `full` by the migration). Plant one urgent test mail: a push arrives within the M5 target and its tap opens `/activity?category=urgent`.
- **O5** Read the changed legal texts (stage 13, `TERMS_VERSION` bump) and write the `03-product-frame.md` §4 Telegram line (PD-092). Coordinator default: land stage 13; the owner sees the terms dialog at the next sign-in.
- After stages 02 and 10: `bun run db:migrate` on the shared dev DB (coordinator or owner).

## Gates

- **G-A** Stage 06 starts only after O3 passed. Fail → stop and report; fallback is a WebCrypto push library in a new stage 01b (owner decides).
- **G-mig** Stages 02 and 10 each run only when no other ticket's migration stage is running or unlanded.
- **G-flag** No deploy between the lands of 07 and 08: a build with 07 and without 08 queues push rows with no sender (the pilot org has `web_push` on since O2).
- **G-papers** `web_push` on for no org other than the owner's pilot org until stage 13 lands (Q12).
