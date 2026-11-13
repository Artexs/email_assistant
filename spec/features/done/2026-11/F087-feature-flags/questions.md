# F087 · Open questions (small: the stages do not change with the answer)

Each has a default that the plan uses now. Answer only to change one.

1. **A "clear" command (back to the default)?** `org:flag` sets `--on` or `--off`; nothing deletes a row. An `--off` row stays off when a flag's default later turns on. Default: no clear in F087; E7's console may add it. (plan.md D12)
2. **Must the operator be a member of an organization?** The operator check runs after the tenant check, so an operator with no membership gets `403 no_organization`. You are the pilot owner, so this holds for you. Default: yes, keep the order; E7 decides if it needs an operator without an organization. (D17)
3. **Remove-by dates of the three placeholder flags.** `stats_page` (E3a), `approvals_page` (E4-A), `sent_sync` (E5a): all `2027-03-01`, the date of the plan input. On that day a unit test fails until a cleanup ticket removes or extends the flag. Default: `2027-03-01` for all three. (D20)
4. **After the dev-database check (owner step U2), leave `stats_page` on for the pilot?** Nothing reads it yet, so "on" changes nothing today; it would show the stats page to the pilot the day E3a lands. Default: turn it off again after the check, so every flag stays off until its epic ships and turns it on on purpose. The `--off` leaves a row, so the epic that ships the stats page turns the pilot on with `org:flag --on`, not by a default change (plan.md D11, review N2). (plan.md § User steps, U2)
