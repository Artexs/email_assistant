# F105 · Open questions (small: the stages do not change with the answer)

Each has a default that the plan uses now. Answer only to change one. No question blocks the build.

1. **Who chooses the break-glass owner?** Default: only the operator, with the CLI `org:break-glass` (no panel choice). The SSO setup that needs it is operator-only too (PD-041). (plan.md D11)
2. **Trusted device for everyone, also operators and the break-glass owner?** Default: yes, 30 days for every user, as the discovery notes say ("trusted device 30 days"). Turning TOTP on again ends all old trusted devices. "Sign out everywhere" does not end them (a trusted device still needs the password). (D1, D9)
3. **QR code library.** Default: add `uqr` 0.1.3 (MIT, no dependencies) to the web app, so the phone can scan the setup code. Without it the user types a 52-character key. (D19)
4. **No feature flag for two-factor sign-in.** Default: no flag. It is a security control; nothing changes for a member who does not turn it on, and the operator rule must not depend on a flag. This departs from PD-045, as the send limits of F099 did. (D18)
5. **TOTP code replay inside its 90-second window.** The plugin accepts the same code again inside the window. Default: accept (a stolen code needs the password too). A guard needs our own column and hook. (D26)
6. **Who may turn TOTP off?** Default: every member, except the break-glass owner (refused). An operator may turn it off; the console then refuses until it is on again. (D10, D12)
7. **The operator reset ends every session and trusted device of the user and clears the break-glass designation.** Default: yes; the user signs in again with the password and can enrol again. The operator checks the person's identity outside the system first (docs). (D13)
8. **No mail about 2FA changes.** Default: no mail (the auth-mail sender is off on the VPS); the security log shows every change. (D7, PD-048)
9. **Polish text of the button "I saved the codes".** [minor] Default: "Mam zapisane kody" (neutral), not "Zapisałem kody" (male speaker). `pl.ts` has no first-person past form, which in Polish shows the speaker's gender. (stage 11, refresh 1)
