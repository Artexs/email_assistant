# F170 questions (defaults taken by the planner, 2026-11-24)

No blocking question. Each item names the default the stages build; the owner can change it before the stage builds.

1. **[important: user-visible]** Onboarding mode cards (plan P1). Default: the cards explain the two modes; Shadow keeps today's "Keep shadow mode" button; Assist opens the same dialog as Settings when the organization has one mailbox, and links to Settings when it has two or more. Other option: Assist always links to Settings (no mode change on the onboarding page at all, as PB-4 reads). Undo: stage 06 only.
2. **[important: scope]** Mailbox Pause and Resume (plan P2). PB-7 lists "the mailbox pause button" as a mockup item with no data, but the panel has Pause and Resume today. Default: they stay (PB-4: every control stays). The coordinator may correct the PB-7 wording on the programme page.
3. **[important: user-visible]** OAuth mailbox with a login error (plan P3). Default: the card says the access was withdrawn or expired, shows no "Change password" (the server always refuses it for OAuth), and offers "Connect mailbox" (today's dialog; signing in with the same account reconnects it). Other option: keep today's card (a password button that always fails).
4. **[minor]** The Settings section links do not stick to the top on a phone (plan P5); "one tap" counts from the top of the page. A sticky row needs the height of the shell's top bar, a contract of the shell ticket.
5. **[minor]** The Account card splits into three cards: Account (`data-card="account"`), Security (`security`) and Delete organization (`delete-organization`, the danger tone), as in the mockup (stage 05).
6. **[minor]** The Stats head uses the newest week the API sends, and three numbers: serious mistakes, urgent mail p90, delegations (or loops) closed on time (plan P6).
