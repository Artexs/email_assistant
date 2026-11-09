# Dev run digest output (stage 14, sync-sort-folders)

Synthetic mail on GreenMail, `fake-tg read` after `/digest`, 2026-11-09 14:37Z (button rows cut).

```text
📬 Digest now · Mon 9 Nov 15:37
Since 8 Nov 15:26: 10 mails, 4 need action
🔄 Last sync 15:35

NEEDS ACTION · 4
1. 🔴 Urgent · <sender> · 📁 Wiadomości-śmieci · 🧪 test
<subject>
→ done: move to INBOX

2. 🔴 Urgent · <sender> · 📁 Oferty · 🧪 test
<subject>
→ done: flag

3. ✉️ Reply · <sender> · 📁 Wiadomości-śmieci · 🧪 test
<subject>
→ done: move to INBOX

4. ✉️ Reply · <sender> · 📁 Oferty · 🧪 test
<subject>
→ stays in Oferty

OTHER MAIL · 6
5. 🔔 Notification · <sender> · 📁 Wiadomości-śmieci · 🧪 test
→ done: move to AI/Notifications, mark read

6. 🔔 Notification · <sender> · 📁 Oferty · 🧪 test
→ done: move to AI/Notifications, mark read

7. 🚫 Spam · <sender> · 📁 Wiadomości-śmieci · 🧪 test
→ stays in Wiadomości-śmieci

8. 🚫 Spam · <sender> · 📁 Wiadomości-śmieci · 🧪 test
→ stays in Wiadomości-śmieci

9. 🚫 Spam · <sender> · 📁 Oferty · 🧪 test
→ would move to AI/Spam

10. 🚫 Spam · <sender> · 📁 Oferty · 🧪 test
→ would move to AI/Spam
```

Urgent notice (one only, for the `Oferty` mail; none for the spam folder `urgent` mail, D23):
`🔴 Urgent mail · 📁 Oferty · 🧪 test`

The sender and subject text of the synthetic mail is replaced by `<sender>` and `<subject>`.

## Open points of the stage 14 dev run

- The dev run did not exercise the `info` path: the classifier gave `spam` for the synthetic `info` mail. So the run did not show an `AI/Info` move from a synced folder. Stage 17 (live checks) must cover `info`.
- The `uid updated` counter in the sync log (`uidUpdated`, `apps/server/src/modules/mail/sync.ts`) likely counts updates that write the same value (the row already had that UID and folder). Do not read it as "UIDs changed". Stage 17 compares the first-sync counts: check what the counter counts before it compares.
