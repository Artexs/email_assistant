# F098 · Open defaults (owner to confirm)

None of these blocks the build. Each is a numbered decision in [plan.md](plan.md) § Input. Change one before the stage that uses it; a change after the land is a small follow-up commit.

1. **Glossary and register** (P6; stages 02, 06–11). Informal "ty", imperative buttons. Key words: delegation = "zlecenie", delegate = "wykonawca" ("delegacja" means a business trip), digest = "podsumowanie", notice = "komunikat", shadow mode = "tryb podglądu", assist mode = "tryb asystenta", draft = "szkic", categories Pilne / Odpowiedz / Przekaż / Niepewne / Info / Powiadomienie / Spam. Option: other words; tell which.
2. **Account choice has two options, no "browser language"** (P3; stage 04). Once a user chooses, the panel no longer follows the browser. Option: a third option that writes null again.
3. **No feature flag for the language** (P5; all stages). ADR 0027 says flags are not product settings; the Account choice is the switch. Option: a per-organization `polish_ui` flag (public pages and Telegram need extra reads).
4. **Telegram consent: chats linked before stage 05 keep their link** (P4; stage 05). Only new link requests need the tick. Option: ask every linked user once (needs a consent check on the bot side).
5. **The operator CLI `telegram:link` needs no consent** (P4; stage 05). It is the operator's tool for their own account. Option: a `--consent-given` flag that writes the same audit row.
6. **Consent text** (P4; stage 05, exact pl and en text in the stage file). The agent's draft (S6 P19): names sender, subject, AI reason or summary, draft texts with quoted parts, delegate names, mailbox addresses; servers outside the EU; no end-to-end encryption; kept until deleted in the chat. Option: change the text (bump `TELEGRAM_CONSENT_VERSION`).
7. **Public pages follow this browser's last choice, else the browser** (P8; stages 01, 03). `/404` and `/` show Polish and English lines. Option: a language switch on the login page.
8. **Telegram replies to `/start` with a used or expired link come in the token owner's language** (D12; stage 11). Option: Telegram's own `language_code` of the sender.
9. **Old approval cards** (D16; stage 12). Cards queued before the deploy of stage 12 keep their English text; a tap adds a Polish status line for users without a stored language. Accepted for 48 h.
10. **The activity list shows English action phrases in a Polish panel between stages 02 and 13** (D17). Accepted while the stages land.
11. **The command menu follows the Telegram app language, not the Account choice** (D20; stage 11). Polling sets an English default list and a Polish list for `language_code: "pl"`. Option: a per-chat menu set at link time and at each choice change.
12. **Thirteen stages instead of about six** (cold review 1, findings M1–M5). The first version had eight stages; five were over one job's size. Option: none needed; stage count does not change the outcome.
