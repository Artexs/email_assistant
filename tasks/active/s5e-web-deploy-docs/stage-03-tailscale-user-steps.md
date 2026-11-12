# s5e-web-deploy-docs — Stage 3

Part of [`../s5e-web-deploy-docs.md`](../s5e-web-deploy-docs.md). Read that file's A1–A9, "Facts checked" (6–8), E4, E5, "Rules for every step" and "User steps" first.

## Stage 3 — User steps: the Tailscale account, the VPS, this PC, the phone [risky] — gated, user and main session

The user does every step. The main session gives the steps one at a time in chat (STE, one command per step), waits for "done", and runs only the read-only checks named here, after the user's go for them. No code, no commit except the log line. The user may run this stage before or during stages 1–2.

- [x] **3.1 Account and admin console** (the user)
  - Ask first: "Do you have a Tailscale account (tailnet) already?" Yes → sign in at https://login.tailscale.com/admin. No → create a free Personal account there (sign in with Google or GitHub; A2).
  - Admin console → DNS: MagicDNS on (default for new tailnets); HTTPS Certificates → "Enable HTTPS", and acknowledge the public ledger (fact 7: the machine names and the tailnet DNS name become public in Certificate Transparency logs).
  - Before HTTPS is on, the user chooses the final tailnet DNS name (the random `tailXXXX` name or a "fun name" on the DNS page): a later rename changes `WEB_BASE_URL`, the certificate and the HSTS host.
  - Check (the user reads it): the DNS page shows the tailnet DNS name `<tailnet>.ts.net` and "HTTPS: enabled". The user does not paste the tailnet name into the chat if they prefer; the agent never writes it into a file.

- [x] **3.2 This PC** (the user, `sudo`)
  - `sudo pacman -S tailscale`; `sudo systemctl enable --now tailscaled`; `sudo tailscale up` (accept DNS: the default; open the printed URL, sign in).
  - Check (agent, read-only, on this PC, after the user's ok): `tailscale status` shows this PC; `tailscale status --json | bun -e 'const s = JSON.parse(await Bun.stdin.text()); console.log(s.CurrentTailnet?.MagicDNSEnabled ? "magicdns on" : "magicdns off", s.Self.Online)'` (prints no name; `MagicDNSSuffix` is set even with MagicDNS off). Then `getent hosts example.com` still resolves (the PC's normal DNS works with MagicDNS on); `curl -sS -o /dev/null -w '%{http_code}' https://registry.npmjs.org/` → `200`. Docker containers on this PC must still resolve names (the stage 2 build runs `bun install`): `newgrp docker <<'EOF'` `docker run --rm oven/bun:1.3.14 bun -e 'console.log((await fetch("https://registry.npmjs.org/")).status)'` `EOF` → `200`.
  - Risk: MagicDNS changes the PC's resolver (systemd-resolved). If dev tools fail to resolve names afterwards, stop and tell the user. Do not switch MagicDNS off on this PC: without it the `ts.net` name does not resolve, and the tailnet IP does not work with HTTPS (the certificate names the host; E5). Write the result in the log.

- [x] **3.3 The VPS** (the user, `sudo`, on the VPS console or over the LAN SSH `home_vm`; never over Tailscale)
  - `curl -fsSL https://tailscale.com/install.sh | sh` (adds the Tailscale apt repository on Ubuntu 22.04 and installs `tailscale`).
  - `sudo tailscale up --accept-dns=false --hostname=email-assistant`; open the printed login URL on the PC and approve the machine.
  - Admin console → Machines → `email-assistant` → menu → "Disable Key Expiry" (fact 8).
  - Check (agent, read-only over `ssh home_vm`, after an explicit go of the user for these checks; task file rules): `tailscale status --json | bun -e …` or `jq` prints only whether `.Self.DNSName` starts with `email-assistant.` (if Tailscale gave `email-assistant-1`, stop: rename the machine in the admin console) and whether this PC is listed (log "yes/no", never the raw output); `tailscale version` (write it in the log; Serve needs 1.52 or later, fact 6); `systemctl is-enabled tailscaled` → `enabled`; `resolvectl status 2>/dev/null | grep -c 100.100.100.100` → 0 (the host resolver did not change, A6); `docker compose -f deploy/compose.yaml --env-file .env ps --format '{{.Service}} {{.Status}}'` → `db` and `server` up and healthy (the pilot still runs); `ss -ltn` (write the full list in the log: the "before" list for E9). The pilot after `tailscale up` (it adds `ts-*` firewall chains and routes): `docker compose -f deploy/compose.yaml --env-file .env logs --since 10m server | grep -ciE '\b(error|fatal)\b'` → 0; a sync tick line in the last 10 minutes; the user sends `/status` to the pilot bot and gets an answer.
  - If `tailscale up` changed the resolver anyway (`resolvectl` shows `100.100.100.100`): `sudo tailscale set --accept-dns=false`, check again.

- [ ] **3.4 The phone** (the user)
  - Install the Tailscale app from the App Store or Play Store, sign in with the same account, switch the VPN on.
  - Check (the user): the app lists `email-assistant` and this PC. Write the phone type (iOS or Android, browser name) in the log; the hand smoke in stage 4 uses that browser.

- Done when: 3.1–3.4 hold; the log line names the Tailscale version on the VPS, the phone type, and the `ss -ltn` "before" list (no names of the tailnet). The log is committed on `master` in step 4.7.
- Out of scope: `tailscale serve` (stage 4, after the server publishes `127.0.0.1:8080`), any `.env` change, Tailscale SSH, exit nodes, ACL edits (the default policy of a Personal tailnet lets your own devices reach each other).

### Stage 3 log

- 2026-11-11/12: the user already had a tailnet and Tailscale on this PC (1.104.2, MagicDNS on); the handoff said "no Tailscale anywhere", which was wrong. 3.2: `tailscale status` lists this PC, `getent hosts` and `curl https://registry.npmjs.org/` → 200, a Docker container fetch → 200.
- 3.3: the user installed Tailscale 1.104.6 on the VPS. Two faults found by the read-only checks and fixed by the user: the machine was `ubuntu` (fix `sudo tailscale set --hostname=email-assistant`) and the host resolver had `100.100.100.100` (fix `sudo tailscale set --accept-dns=false`). After the fix: `resolvectl | grep -c 100.100.100.100` → 0; the machine name starts with `email-assistant.`; this PC lists it online; key expiry none; `systemctl is-enabled tailscaled` → `enabled`; `db` and `server` healthy, 0 `error` lines in 10 min, sync lines present. `ss -ltn` before (5 lines): `22` on `0.0.0.0` and `[::]`, `127.0.0.53:53`, and two `tailscaled` ports on the tailnet addresses (37153, 49905).
- 3.4 open: the phone is a `OnePlus 12` (Android) in the tailnet but was offline at every check; no phone sign-in is in the audit yet (`web.login` 3 = the PC and two agent runs). The user has to sign in on the phone and name the browser (the day of use, stage 6).
