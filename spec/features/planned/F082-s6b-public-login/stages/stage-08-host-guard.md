# F082 stage 08 — Mail host guard: ranges, `resolveMailHost`, policy [risky]

Part of [`../plan.md`](../plan.md). Read its F8–F10, L23, L24, L26 and "Rules for every stage" first, and `apps/server/src/modules/mail/host-check.ts`.

Parallel: lane B; needs nothing. It may run at the same time as any of stages 1–7 (its files are only in `modules/mail/`).

One step. This stage builds and tests the guard; nothing calls it yet (stage 9 wires it into every connect).

- [ ] **8.1 The address check of a mail host**
  - Goal: one function turns a mail host name into one checked address, and refuses a host that is or resolves to a local, private, Tailscale or benchmark address.
  - Files: change `apps/server/src/modules/mail/host-check.ts`, `host-check.test.ts`; add `apps/server/src/modules/mail/host-guard.ts`, `host-guard.test.ts`; change `apps/server/src/modules/mail/index.ts` (exports).
  - Interfaces:

    ```ts
    // host-check.ts
    // True for an IPv4 or IPv6 literal in a refused range (the six existing IPv4 ranges, 100.64.0.0/10, 198.18.0.0/15,
    // 192.0.0.0/24, and the existing IPv6 ranges; an IPv4-mapped IPv6 address is checked as IPv4). A string that is not an IP → true.
    export function isLocalAddress(ip: string): boolean;
    // isLocalMailHost keeps its contract and uses isLocalAddress for IP literals.

    // host-guard.ts
    export type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;
    export interface MailHostPolicy {
      allowLocal: boolean;
      lookup: LookupAll;
    }
    export interface MailTarget {
      host: string;
      servername?: string;
    } // servername only when host is a resolved address
    export const dnsLookupAll: LookupAll; // (host) => lookup(host, { all: true, verbatim: true }) from "node:dns/promises"
    export const DEFAULT_MAIL_HOST_POLICY: MailHostPolicy; // { allowLocal: false, lookup: dnsLookupAll }
    export function configureMailHosts(input: { allowLocal: boolean; lookup?: LookupAll }): void; // sets the process policy
    export function mailHostPolicy(): MailHostPolicy; // the process policy; DEFAULT_MAIL_HOST_POLICY until configured
    export function resolveMailHost(host: string, policy?: MailHostPolicy): Promise<MailTarget>; // policy default: mailHostPolicy()
    ```

  - Decisions (L23, L24):
    - Add `["100.64.0.0", 10]`, `["198.18.0.0", 15]`, `["192.0.0.0", 24]` to the IPv4 list.
    - `resolveMailHost` order: (1) `policy.allowLocal` → `{ host }` unchanged, no lookup. (2) `isLocalMailHost(host)` → `throw new HostNotAllowedError()` (from `./port`), no lookup. (3) `name = host.trim().replace(/\.+$/, "")`; `literal = name.replace(/^\[/, "").replace(/\]$/, "")`; `isIP(literal) !== 0` → `{ host: literal }` (no lookup; step 2 already refused a local literal). (4) `addresses = await policy.lookup(name)`; a rejection → `throw new SoftError(\`mail host lookup failed (${code})\`, { cause })`with`code`= the error's string`code`or`UNKNOWN`. (5) no address → `SoftError("mail host lookup failed (ENODATA)")`. (6) any address with `isLocalAddress(address)`→`throw new HostNotAllowedError()`. (7) the first IPv4 address, else the first address: `{ host: <that address>, servername: name }`. Why IPv4 first: the old code let `net.connect`pick, and most mail hosts (the pilot's`poczta.interia.pl` too) answer IPv4; a host whose chosen address is dead fails the connect (accepted; cold review finding 5).
    - No log line in this module. Error texts hold no host name and no address.
    - `index.ts` exports `configureMailHosts`, `mailHostPolicy`, `resolveMailHost`, `isLocalAddress`, `type MailTarget`, `type LookupAll`.
  - Test:
    1. `host-check`: `isLocalAddress` → `true` for `100.64.0.1`, `100.127.255.255`, `198.18.0.1`, `198.19.255.255`, `192.0.0.8`, `::ffff:100.64.0.1`, `127.0.0.1`, `10.1.2.3`, `fe80::1`, `not-an-ip`; `false` for `100.128.0.1`, `198.20.0.1`, `192.0.1.1`, `8.8.8.8`, `2001:4860:4860::8888`.
    2. `host-check`: every existing `isLocalMailHost` case still passes; `isLocalMailHost("100.64.0.1")` → `true`.
    3. `host-guard`, fake lookup → `[{ address: "93.184.216.34", family: 4 }]`: `resolveMailHost("imap.x.test", policy)` → `{ host: "93.184.216.34", servername: "imap.x.test" }`; `"imap.x.test."` → the same `servername` without the dot.
    4. Fake → `[8.8.8.8, 10.0.0.5]` → `HostNotAllowedError`.
    5. Fake → `[100.64.1.2]` (Tailscale) → `HostNotAllowedError`.
    6. Rebinding: a fake that answers `93.184.216.34` on the first call and `127.0.0.1` on the second → the first call resolves, the second throws `HostNotAllowedError`.
    7. `"localhost"`, `"127.0.0.1"`, `"[::1]"` → `HostNotAllowedError`, the fake lookup was not called; `"93.184.216.34"` → `{ host: "93.184.216.34" }` without a lookup.
    8. A fake that rejects with `{ code: "ENOTFOUND" }` → `SoftError` with message `mail host lookup failed (ENOTFOUND)`; the message holds no `x.test`.
    9. `allowLocal: true` → `resolveMailHost("localhost")` → `{ host: "localhost" }`, no lookup.
    10. `DEFAULT_MAIL_HOST_POLICY.allowLocal === false`; `configureMailHosts({ allowLocal: true })` → `mailHostPolicy().allowLocal === true`; the test restores the previous policy in `finally`.
    11. Fake → `[{ address: "2001:4860:4860::8888", family: 6 }, { address: "93.184.216.34", family: 4 }]` → `{ host: "93.184.216.34", servername: … }`; fake → only the IPv6 address → that address.
  - Check: Proof (server form, `/tmp/f082-s08`).
  - Done when: the tests pass and the Proof printed `PROOF_OK`.
  - Out of scope: the connect wiring, the config key and the scripts (stage 9).
