import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import type { SecretBox } from "../../../platform/crypto";
import type { DB, Db, TenantContext } from "../../../platform/db";
import { errorFields, HardError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { auditEvents, recordAudit } from "../../audit";
import { insertDefaultSettings } from "../../config";
import { getOrgPlan, isFeatureOn } from "../../tenancy";
import { buildFolderMap, runOnConnected, withDeadline, type OnConnected } from "../connect";
import type { ImapConnectOptions } from "../imap/client";
import type { SmtpConnectOptions } from "../imap/smtp";
import {
  MailAuthError,
  MailboxExistsError,
  MailboxLimitError,
  type AuthMaterial,
  type MailProvider,
  type MailServerInfo,
  type OAuthTokens,
} from "../port";
import {
  countMailboxesOfOrg,
  findMailboxIdByAddress,
  finishMailboxReconnect,
  insertCredentials,
  insertInboxFolder,
  insertMailbox,
  insertSentSyncState,
  lockMailbox,
  lockMailboxLimit,
  getMailbox,
  getCredentials,
  mailboxStatusSchema,
  type MailboxRow,
  type MailboxStatus,
} from "../repo";

import type { OAuthGrant, OAuthRefusalCode } from "./callback";
import { OAuthGrantError, type MailOAuthClient, type MailOAuthClients } from "./client";
import { mailOAuthFlag } from "./providers";
import { encodeOAuthSecret, saveOAuthSecret, withMailboxOAuthLock, type OAuthSecret } from "./secret-store";

// Connect and Reconnect of an OAuth mailbox. The checked grant of `finishOAuthCallback` comes in; a mailbox row (Connect)
// or a replaced secret (Reconnect) goes out, or one refusal code. A refusal stores nothing.
// No token, code, `state`, verifier or provider text reaches a log line, an error, a result or an audit row (secrets rule).
// The login tests use `user = grant.address`: the access token binds that address to the real account.

const log = createLog("mail");

/** What the callback route redirects with (the `oauth` query value). */
export type OAuthResultCode = OAuthRefusalCode | "connected" | "reconnected";

export type ApplyResult =
  | { ok: true; code: "connected" | "reconnected"; mailboxId: string }
  | { ok: false; code: OAuthRefusalCode };

export interface ApplyGrantDeps {
  /** The pool, never a caller's transaction: the Reconnect lock is a transaction of its own. */
  db: Db;
  secrets: SecretBox;
  /** The client of a provider holds its spec (hosts, send route) and the refresh call that tests Microsoft `Mail.Send`. */
  clients: MailOAuthClients;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  verifySmtp(opts: SmtpConnectOptions): Promise<void>;
  /** The access-token cache of the mailbox is dropped after a Reconnect commits. Absent: nothing to drop. */
  oauthTokens?: Pick<OAuthTokens, "drop">;
  now(): Date;
  /** The web sets it: the socket timeout of each login and the deadline of the whole check. */
  timeouts?: { socketMs: number; deadlineMs: number };
  /** After the commit of a new mailbox (Connect only, never Reconnect); see `OnConnected`. */
  onConnected?: OnConnected;
}

const refuse = (grant: OAuthGrant, code: OAuthRefusalCode): ApplyResult => {
  log.info("oauth_callback_refused", { provider: grant.provider, code });
  return { ok: false, code };
};

/** A refused login (`MailAuthError`) means the provider or the tenant blocks the protocol. Another fault is the operator's or the network's. */
function loginRefusal(error: unknown): OAuthRefusalCode {
  return error instanceof MailAuthError ? "protocol_disabled" : "oauth_failed";
}

interface Login {
  host: string;
  port: number;
  smtp: { host: string; port: number; security: SmtpConnectOptions["security"] };
}

/**
 * The IMAP login with the access token, then the second proof of the provider: Google an SMTP login (XOAUTH2); Microsoft one refresh
 * for `graph` that proves `Mail.Send` consent. Returns the server info and the refresh token to store (Microsoft may rotate it).
 */
async function testLogin(
  deps: ApplyGrantDeps,
  grant: OAuthGrant,
  client: MailOAuthClient,
  target: Login
): Promise<{ ok: true; info: MailServerInfo; refreshToken: string } | { ok: false; code: OAuthRefusalCode }> {
  const { timeouts } = deps;
  const auth: AuthMaterial = { kind: "oauth", accessToken: grant.mailAccessToken };
  let info: MailServerInfo;
  try {
    info = await withDeadline(
      (async () => {
        const provider = await deps.openProvider({
          host: target.host,
          port: target.port,
          user: grant.address,
          auth,
          connectionTimeoutMs: timeouts?.socketMs,
        });
        try {
          return await provider.serverInfo();
        } finally {
          await provider.close();
        }
      })(),
      timeouts?.deadlineMs
    );
  } catch (error) {
    log.warn("oauth_login_failed", { provider: grant.provider, kind: "imap", ...errorFields(error) });
    return { ok: false, code: loginRefusal(error) };
  }

  let refreshToken = grant.refreshToken;
  if (grant.provider === "google") {
    try {
      await withDeadline(
        deps.verifySmtp({
          host: target.smtp.host,
          port: target.smtp.port,
          security: target.smtp.security,
          user: grant.address,
          auth,
          timeoutMs: timeouts?.socketMs,
        }),
        timeouts?.deadlineMs
      );
    } catch (error) {
      log.warn("oauth_login_failed", { provider: grant.provider, kind: "smtp", ...errorFields(error) });
      return { ok: false, code: loginRefusal(error) };
    }
  } else {
    try {
      const answer = await withDeadline(client.refresh(grant.refreshToken, "graph"), timeouts?.deadlineMs);
      // Microsoft rotates the refresh token at each redeem: the newest one is the one to store.
      if (answer.refreshToken !== null) refreshToken = answer.refreshToken;
    } catch (error) {
      log.warn("oauth_login_failed", { provider: grant.provider, kind: "graph", ...errorFields(error) });
      // A refused grant for `graph` after a good mail grant: the user did not consent to `Mail.Send`.
      return { ok: false, code: error instanceof OAuthGrantError ? "admin_consent_required" : "oauth_failed" };
    }
  }
  return { ok: true, info, refreshToken };
}

function secretOf(grant: OAuthGrant, refreshToken: string): OAuthSecret {
  return { v: 1, provider: grant.provider, refreshToken, tenantId: grant.tenantId, scopes: grant.scopes };
}

function isMailboxAddressViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const fields = error as { code?: unknown; constraint?: unknown };
  return fields.code === "23505" && fields.constraint === "mailboxes_org_address_key";
}

/**
 * Connect (`grant.start.mailboxId` null) or Reconnect (set; the callback checked the address).
 * @param actor the user id of the session: the audit actor.
 */
export async function applyOAuthGrant(
  deps: ApplyGrantDeps,
  ctx: TenantContext,
  grant: OAuthGrant,
  actor: string
): Promise<ApplyResult> {
  const client = deps.clients[grant.provider];
  if (client === undefined) return refuse(grant, "not_configured");
  return grant.start.mailboxId === null
    ? connect(deps, ctx, grant, client, actor)
    : reconnect(deps, ctx, grant, client, grant.start.mailboxId, actor);
}

async function connect(
  deps: ApplyGrantDeps,
  ctx: TenantContext,
  grant: OAuthGrant,
  client: MailOAuthClient,
  actor: string
): Promise<ApplyResult> {
  const { spec } = client;
  // The flag may have gone off since the start. Before any login.
  if (!(await isFeatureOn(deps.db, ctx, mailOAuthFlag(grant.provider)))) return refuse(grant, "feature_off");
  // Before any login: a duplicate or an organization at its limit never opens a connection.
  if ((await findMailboxIdByAddress(deps.db, ctx, grant.address)) !== undefined) return refuse(grant, "mailbox_exists");
  const plan = await getOrgPlan(deps.db, ctx);
  if (plan === undefined) throw new HardError("organization not found");
  if ((await countMailboxesOfOrg(deps.db, ctx)) >= plan.maxMailboxes) return refuse(grant, "mailbox_limit");

  const tested = await testLogin(deps, grant, client, {
    host: spec.imap.host,
    port: spec.imap.port,
    smtp: spec.smtp,
  });
  if (!tested.ok) return refuse(grant, tested.code);

  // "Track my sent mail" starts on only while the organization flag is on: the same rule as `connectMailbox`. Never on for a real
  // organization here (owner decision log).
  const sentSync = await isFeatureOn(deps.db, ctx, "sent_sync");
  const mailboxId = randomUUID();
  const sealed = deps.secrets.encrypt(encodeOAuthSecret(secretOf(grant, tested.refreshToken)), `mailbox:${mailboxId}`);

  const run = async (trx: Transaction<DB>): Promise<void> => {
    // The lock covers only the check and the inserts, never a login.
    await lockMailboxLimit(trx, ctx);
    const current = await getOrgPlan(trx, ctx);
    if (current === undefined) throw new HardError("organization not found");
    if ((await countMailboxesOfOrg(trx, ctx)) >= current.maxMailboxes)
      throw new MailboxLimitError(current.maxMailboxes);
    await insertMailbox(trx, ctx, {
      id: mailboxId,
      address: grant.address,
      imapHost: spec.imap.host,
      imapPort: spec.imap.port,
      smtpHost: spec.smtp.host,
      smtpPort: spec.smtp.port,
      smtpSecurity: spec.smtp.security,
      sendVia: spec.sendVia,
      oauthProvider: grant.provider,
      capabilities: tested.info.capabilities,
      folderMap: buildFolderMap(tested.info.folders),
    });
    await insertInboxFolder(trx, ctx, mailboxId);
    await insertCredentials(trx, ctx, {
      mailboxId,
      encryptedSecret: sealed.ciphertext,
      secretKind: "oauth",
      keyVersion: sealed.keyVersion,
    });
    await insertDefaultSettings(trx, ctx, mailboxId);
    await insertSentSyncState(trx, ctx, mailboxId, { enabled: sentSync });
    await recordAudit(trx, ctx, {
      actor,
      event: auditEvents.mailboxConnected,
      data: { mailbox_id: mailboxId, via: "web", method: "oauth", provider: grant.provider, sent_sync: sentSync },
    });
  };

  try {
    await deps.db.transaction().execute(run);
  } catch (error) {
    // A concurrent connect of the same address wins the unique index: this one is the loser.
    if (error instanceof MailboxLimitError) return refuse(grant, "mailbox_limit");
    if (error instanceof MailboxExistsError || isMailboxAddressViolation(error)) return refuse(grant, "mailbox_exists");
    throw error;
  }
  log.info("oauth_mailbox_connected", { provider: grant.provider, mailbox_id: mailboxId });
  await runOnConnected(deps.onConnected, ctx, mailboxId);
  return { ok: true, code: "connected", mailboxId };
}

/** `auth_error` and `host_blocked` become `active`; `paused` stays paused. */
const statusAfterReconnect = (status: MailboxStatus): MailboxStatus =>
  status === "auth_error" || status === "host_blocked" ? "active" : status;

async function reconnect(
  deps: ApplyGrantDeps,
  ctx: TenantContext,
  grant: OAuthGrant,
  client: MailOAuthClient,
  mailboxId: string,
  actor: string
): Promise<ApplyResult> {
  // The flag is not read: a Reconnect works with the flag off, so a mailbox is never stranded.
  const mailbox: MailboxRow | undefined = await getMailbox(deps.db, ctx, mailboxId);
  // A mailbox removed since the callback check, a password mailbox or one of another provider has nothing to reconnect.
  if (mailbox === undefined || mailbox.oauth_provider !== grant.provider) return refuse(grant, "oauth_failed");

  // The login tests run at the hosts stored on the mailbox, the hosts the jobs connect to with the new token. A check against the registry
  // hosts would strand a mailbox after a registry change. No path changes the stored hosts; the insert took them from the registry.
  const tested = await testLogin(deps, grant, client, {
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    smtp: { host: mailbox.smtp_host, port: mailbox.smtp_port, security: mailbox.smtp_security },
  });
  if (!tested.ok) return refuse(grant, tested.code);

  const now = deps.now();
  const outcome = await withMailboxOAuthLock(deps.db, mailboxId, async (tx) => {
    // Under the lock a refresh and a second Reconnect wait: the secret is replaced as one write.
    const locked = await lockMailbox(tx, ctx, mailboxId);
    if (locked === undefined || locked.oauth_provider !== grant.provider) return null;
    const credentials = await getCredentials(tx, ctx, mailboxId);
    if (credentials?.secret_kind !== "oauth") return null;
    await saveOAuthSecret(tx, deps.secrets, ctx, mailboxId, secretOf(grant, tested.refreshToken));
    const before = mailboxStatusSchema.parse(locked.status);
    const status = statusAfterReconnect(before);
    await finishMailboxReconnect(tx, ctx, mailboxId, { status, at: now });
    await recordAudit(tx, ctx, {
      actor,
      event: auditEvents.mailboxReconnected,
      data: {
        mailbox_id: mailboxId,
        via: "web",
        provider: grant.provider,
        reactivated: status !== before,
      },
      at: now,
    });
    return status;
  });
  if (outcome === null) return refuse(grant, "oauth_failed");
  // After the commit: the next job reads the new secret, not a cached access token of the old grant.
  deps.oauthTokens?.drop(mailboxId);
  log.info("oauth_mailbox_reconnected", { provider: grant.provider, mailbox_id: mailboxId });
  return { ok: true, code: "reconnected", mailboxId };
}
