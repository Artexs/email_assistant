# F082 stage 14 — Docs, ADR 0016 amendment, note

Part of [`../plan.md`](../plan.md). Read its L31, "Done when" and "Rules for every stage" first, and the code of stages 1–13 (`git log --oneline` of the S6b commits). Needs stages 1–13.

Parallel: none. It needs stages 1–13 landed.

Three steps. Docs only: no code change. Write in the style of the file you change (short sentences, active voice).

- [ ] **14.1 `docs/architecture.md` §7 and `docs/code-patterns.md`**
  - Goal: §7 lists every S6b control as built.
  - Files: change `docs/architecture.md` §7, `docs/code-patterns.md` (check that stages 1, 2 and 5 added their lines; add what is missing).
  - Decisions: in §7 "Web security", change or add these bullets (one fact each, from the code):
    - **Auth allow-list:** add `request-password-reset` (POST), open only when the auth-mail sender is on (else 404).
    - **Reset request:** same answer for every address; limits 3 per 15 min per client address and 3 per hour per address (the 4th gets the same answer and no mail); the send does not hold the request; a server link lasts 1 hour, a CLI link 24 hours.
    - **Auth mail:** `AUTH_SMTP_*`, `AUTH_MAIL_FROM`, all or none; certificates checked; 15 s timeout; plain text, no tracking; no outbox row; a failed mail = a `warn` line (user id, code) and the operator notice `auth_mail_failed` (one per user, code and day). Off on the home VPS.
    - **Lockout:** 10 failed sign-ins in 15 minutes lock the user for 15 minutes; same answer and time as a wrong password; one mail per lock, at most 3 per day; a password reset ends the lock; audit `web.login_locked`; table `auth_lockouts`.
    - **Leaked passwords:** Have I Been Pwned range API (5 hex characters of the SHA-1 leave the server), 5 s timeout, fail closed (503, nothing changes); `AUTH_PWNED_CHECK=off` only in tests.
    - **Terms:** `TERMS_VERSION` in `packages/core`; every password set needs it (400 `TERMS_REQUIRED`); `users.terms_version`, `terms_accepted_at`; audit `web.terms_accepted`; a newer version shows a blocking dialog; stub pages `/legal/{pl,en}/{privacy,terms,dpa}` are public.
    - **Sessions:** the Account card lists the live sessions (device, address, last day of use), never the token; audit `web.sessions_revoked`, `web.other_sessions_revoked`.
    - **Tenant and role:** the public pages are `/login`, `/setup`, `/forgot`, the legal pages and the static assets.
    - **Audit** bullet: add the new events.
    - In "TLS" or a new bullet **Mail host check:** every IMAP and SMTP connect (form, sync, send, checks, probes) resolves the host once, refuses loopback, private, link-local, `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24` and the IPv6 local ranges, and connects to the checked address with the host name for the certificate; `MAIL_ALLOW_LOCAL_HOSTS=true` only in dev and e2e.
    - Change the line "The code still treats the panel as public (S6 moves it to a public proxy)" to "The code treats the panel as public; the S6 scope change keeps it behind Tailscale."
  - Check: `bunx prettier --check docs/architecture.md docs/code-patterns.md`.
  - Done when: every bullet above is in §7 and matches the code.

- [ ] **14.2 `deploy/README.md` and `.env.example`**
  - Files: change `deploy/README.md` (§ "Web panel"), `.env.example` (check the blocks of stages 2, 6, 9), `docs/known-alerts.md`.
  - Decisions:
    - In "Turn it on" step 2: "Leave `WEB_TRUSTED_ORIGINS`, `MAIL_ALLOW_LOCAL_HOSTS`, `WEB_MAIL_ALLOW_LOCAL`, `WEB_DIST` and the six `AUTH_*` keys empty. Leave `AUTH_PWNED_CHECK` empty (on)."
    - New subsection "Invite a customer (S6b)": `$C exec server bun run org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en] [--trial-days N]`; without the sender it prints the link (24 h); the link is a secret; an existing address stops with `user with this email already exists`.
    - "Give a member a password": add `--print` and "With the sender on, the link goes by mail".
    - New subsection "Auth mail sender (off on the home VPS)": what turns it on (the six keys); what a real sender needs before that: a domain, SPF, DKIM and DMARC records, click and open tracking off at the provider (a tracked link would store the setup link at a third party), port 465 (`tls`) or 587 (`starttls`). No provider is chosen (P18).
    - New subsection "Sign-in lock": a user who typed a wrong password 10 times waits 15 minutes, or gets a new link from `web:invite` (a reset ends the lock).
    - New subsection "Leaked-password check": the server needs outbound HTTPS to `api.pwnedpasswords.com`; when it is down, password sets fail with "try again later".
    - "After the first deploy of S6b": every member sees the terms dialog once at the next sign-in.
    - `docs/known-alerts.md` entry `better-auth: Invalid password`: its Fix line points to F056 for the lockout; change it to "S6b (F082) locks a user after 10 failures in 15 minutes; see `docs/architecture.md` §7." Add an entry `operator notice auth_mail_failed` (cause: the auth-mail sender failed; fix: check the `AUTH_SMTP_*` keys and the provider; status: open while the sender is off).
  - Check: `bunx prettier --check deploy/README.md .env.example docs/known-alerts.md`.
  - Done when: every new key of `.env.example` is named in `deploy/README.md`.

- [ ] **14.3 ADR 0016 amendment, roadmap, note**
  - Files: change `docs/decisions/0016-web-panel-static-build-and-better-auth.md`, `docs/roadmap.md`; add `notes/<build day>-s6b-login-hardening.md`.
  - Decisions:
    - ADR 0016: a section `## Amendment (S6b, <build day>)` with: D7 (an SMTP auth-mail sender with env keys, off without them, no provider in code), D8 (`request-password-reset` opens only with the sender; same answer; limits; 1 h server link, 24 h CLI link), the new public pages, the lockout, the own leaked-password check (and why not the plugin: F7), terms acceptance, the session list through the internal adapter (and why not `/list-sessions`: F6). The "Only these routes are open" line of the Decision gets "(S6b: plus `request-password-reset` with the sender on; see Amendment)". Status stays `accepted`.
    - `docs/roadmap.md`: under the S6 state line add "S6 state (<build day>): S6b built (login hardening: lockout, leaked-password check, terms, session list, mail host check; the auth-mail sender built and off)."
    - The note: the facts a later agent needs: F1–F9 of `plan.md` (one line each, with the file of Better Auth, imapflow or nodemailer); the test preload of `bunfig.toml`; how to turn the sender on; what S6c must do (translate the stub page texts and the auth-mail texts are already in Polish; `users.locale` exists and is set by `org:invite`); what S6e must do (fill the legal pages, change `TERMS_VERSION`); F078 can start (tokens are hashed since F059).
    - Open one planned Limen ticket with `limen ticket new "A mailbox whose host the guard refuses gets a status and a notice" --lane planned` (cold review finding 5: today a refused host is only a `sync <id> failed: host not allowed` log line on every run). Two to four sentences of outcome, no plan.
  - Check: Proof (server form, `/tmp/f082-s14`).
  - Done when: the Proof printed `PROOF_OK`.
  - Out of scope: the legal texts (S6e); the VPS (stage 15).
