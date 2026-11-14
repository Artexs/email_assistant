# F099 · Open questions (small: the stages do not change with the answer)

Each has a default that the plan uses now. Answer only to change one.

1. **Send limits without a flag?** The limits are a safety rule: always on, tuned by the three `SEND_LIMIT_*` env keys. The panel and Telegram texts appear only when a limit holds a send. A flag that is off would hold sends with no visible reason. Default: no flag. (plan.md D1)
2. **The recipient limit per mailbox or per organization?** "5 per recipient per rolling 24 h" (PD-044) counts per mailbox and address. An organization with two mailboxes can send 10 mails a day to one address. Per organization needs a lock over all mailboxes. Default: per mailbox. (D2)
3. **The 6-hour soft-error cap still counts from the tap.** A send that the limit held for more than 6 h and that then meets a temporary SMTP error fails at once ("Send again" works). Moving the cap needs a second column. Default: keep the cap from the tap. (D9)
4. **On the VPS: you are the operator, and the security log is on for the pilot.** Stage 15 sets `OPERATOR_USER_IDS` to the pilot owner's user id and turns `security_log` on for the pilot organization ("on for the pilot first", PD-045). Default: both. (D32)
5. **"Today" in the console's LLM block is the quota day of the LLM cap** (America/Los_Angeles midnight, the same day as `LLM_DAILY_CAP`), not the organization's local day. Default: the quota day; E3a may change it with its stats command. (D18)
6. **Telegram `send_held` notice and the operator notice: once per mailbox per UTC day.** Not per local day. Default: UTC day. (D10, D11)
