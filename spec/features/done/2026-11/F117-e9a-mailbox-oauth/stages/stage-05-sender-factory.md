# F117 stage 05 — Sender factory and the `MailSender` contract suite

Part of [`../plan.md`](../plan.md). Needs stage 04.

## Step 05.1 — Contract suite

**Goal.** One suite that every `MailSender` adapter passes (architecture review §3.7), before the Graph adapter exists.

**Files.** `apps/server/test/contract/mail-sender.ts` (new, next to `mail-provider.ts`).

**Interface.**

```ts
export interface MailSenderHarness {
  open(opts: { from: string }): Promise<MailSender>;
  /** The raw bytes the server got for this Message-ID, or null. */
  received(messageId: string): Promise<Buffer | null>;
  /** A sender whose login the server refuses. */
  openRefused(opts: { from: string }): Promise<MailSender | Error>;
}
export function runMailSenderContract(name: string, harness: () => Promise<MailSenderHarness>): void;
```

**Cases.**
1. `send` of a 1 KB message to `b@x.test` → `accepted` equals `["b@x.test"]`, `rejected` empty.
2. The server gets the raw bytes unchanged (compare the `Message-ID` and `X-EA-Action-Id` lines and the body hash).
3. Two recipients `b@x.test`, `c@x.test` → both accepted.
4. `close()` twice does not throw; `send` after `close` rejects.
5. A refused login rejects with `MailAuthError` (at open or at the first send; the suite accepts both, the adapter documents which). `send.ts` turns only `MailAuthError` into the `auth_error` outcome.

**Runs** against the fake sender (`mail/fake/sender.ts`, unit) and the SMTP sender on GreenMail (integration). GreenMail with auth off refuses no login: case 5 is skipped there with the reason in the test name, and the scripted SMTP server of stage 04 covers it.

## Step 05.2 — Sender choice in `open.ts`

**Goal.** `openMailboxProvider` opens the sender that `mailboxes.send_via` names (D5).

**Interfaces.**
- `OpenDeps.openSender` stays for `smtp`. New optional `OpenDeps.openGraphSender?(opts: { accessToken: string; from: string; freshToken(): Promise<string> }): Promise<MailSender>`; stage 13 supplies it. `freshToken` calls `oauthTokens.accessToken(ctx, id, "graph", { fresh: true })`.
- `send_via = 'graph'` and no `openGraphSender` → `sender: null` (the committer already releases a send without a sender; check that path logs one warn line with the mailbox id).
- The mailbox row type carries `send_via`, `oauth_provider`, `auth_reason` (from stage 03).
- New optional `OpenDeps.oauthTokens?: OAuthTokens`; stage 10 implements it:

```ts
export type TokenResource = "mail" | "graph"; // mail = IMAP and SMTP; graph = Microsoft Graph
export interface OAuthTokens {
  /** A valid access token; `fresh` skips the process cache. */
  accessToken(ctx: TenantContext, mailboxId: string, resource: TokenResource, opts?: { fresh?: boolean }): Promise<string>;
  /** Forget the cached tokens of the mailbox (Reconnect, Remove, a refused login). */
  drop(mailboxId: string): void;
}
```

- An `oauth` credential: IMAP and SMTP get `{ kind: "oauth", accessToken: await oauthTokens.accessToken(ctx, id, "mail") }`; the Graph sender gets the `graph` token. No `oauthTokens` → `HardError("oauth not wired")`.

**Decisions.** D4, D5.

**Edge cases.** A password mailbox with `send_via = 'graph'` cannot exist (stage 03 CHECK needs `oauth_provider = 'microsoft'`); `open.ts` still throws `HardError` if it meets one.

**Test.**
1. Unit or integration: a `send_via = 'smtp'` password mailbox opens the SMTP sender with `{ kind: "password" }` (existing behaviour).
2. `send_via = 'graph'` (row made by SQL with an `oauth` credential), a stub `oauthTokens` that returns `mail-tok` and `graph-tok`, and a stub `openGraphSender` → IMAP gets `mail-tok`, the stub sender gets `accessToken: "graph-tok"` and `from: <mailbox address>`.
3. `send_via = 'graph'` with no `openGraphSender` → `sender` is null and one warn line.

4. An `oauth` credential and no `oauthTokens` → `HardError`, and no connection is opened.

**Check.** The suite and tests above, then the Proof.

**Done when.** The suite runs for the fake and SMTP senders; the tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** The Graph adapter (stage 13), token refresh (stage 10).
