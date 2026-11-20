# F148 questions (defaults taken; no blocking question)

1. [minor] The Telegram consent gate also reads the old hyphen spelling (`2026-11-15-2` = `2026-11-15.2`). Default: yes (plan.md D2). No consent row ever held a hyphen form; writers store only the current constant. Undo: drop the hyphen branch of `parseLegalVersion`.
2. [minor] The parser refuses `.0`, `.1`, leading zeros and impossible dates (plan.md D5). No stored value is in that set. Undo: widen the grammar.
3. [minor] The two hyphen entries of the terms history keep their spelling and form a frozen list (plan.md D3). Undo: none needed.
