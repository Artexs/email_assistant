import { resolve } from "node:path";

import { onboardingOf, scopeInfoOf, type ScopeEnv } from "@ea/core";
import { getConnInfo } from "@hono/bun";
import type { Context } from "hono";

import { orgPlanHooks, sentSwitchHooks, settingsDeps, uidplusOf } from "./composition";
import { actionRoutes, countWaitingApprovals, type ActionsScope, type SendScope } from "./modules/actions";
import { auditEvents, hasAuditEvent, recordAudit, recordAuditOnce } from "./modules/audit";
import {
  approvalRoutes,
  cardEditHooks,
  channelRoutes,
  getChatLinkForUser,
  listUrgentNoticeTimes,
  queueMailboxRemovedNotices,
} from "./modules/channels";
import { countSenderRules, rulesRoutes, settingsRoutes, type SettingsRouteDeps } from "./modules/config";
import { delegateRoutes, delegationHooks, delegationRoutes } from "./modules/delegation";
import {
  createMailOAuthClients,
  getSentSyncView,
  listMailboxes,
  listSyncFolders,
  mailOAuthCallbackRoutes,
  mailOAuthRoutes,
  mailRoutes,
  openImapProvider,
  setSentSync,
  setSyncFolderEnabled,
  type ApplyGrantDeps,
  type MailOAuthClients,
  type TestMailRule,
  verifySmtpLogin,
  WEB_MAIL_TIMEOUTS,
} from "./modules/mail";
import { operatorRoutes } from "./modules/operator";
import { privacyRoutes, type PrivacyRouteDeps } from "./modules/privacy";
import { activityRoutes, statsRoutes } from "./modules/reports";
import {
  anySsoUsable,
  getUserAuthProfile,
  isBreakGlassOwner,
  isFeatureOn,
  isOrgSuspended,
  isPasswordSignInRefused,
  listMembershipsOfUser,
  resolveSsoMember,
  setUserTerms,
  tenancyRoutes,
  type TenancyRouteDeps,
} from "./modules/tenancy";
import { goNoGoFor, setCategoryAutoWithGate, triageRoutes } from "./modules/triage";
import {
  createAuth,
  expiredSessionCookie,
  listUserSessions,
  verifyOwnPassword,
  type AuthDeps,
  type AuthEventKind,
} from "./platform/auth";
import { createLockoutStore } from "./platform/auth-lockout";
import { createAuthMailer, createAuthMailTasks } from "./platform/auth-mail";
import type { AuthMailKind } from "./platform/auth-mail-texts";
import { backupCodesLeft } from "./platform/auth-two-factor";
import {
  authMailSettings,
  mailAllowLocal,
  operatorUserIds,
  webTrustedOrigins,
  webTrustedProxies,
  testMailRule,
  type Config,
} from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { Db, TenantContext } from "./platform/db";
import { errorFields } from "./platform/errors";
import { buildTrustedProxies, signInMethodOf, type WebDeps, type WebSession } from "./platform/http";
import { createLog } from "./platform/log";
import { checkPwnedPassword } from "./platform/pwned";

// The composition root of the web: the parts that need more than one module.
const log = createLog("web");

const eventNames = {
  login: auditEvents.webLogin,
  password_set: auditEvents.webPasswordSet,
  password_changed: auditEvents.webPasswordChanged,
  login_locked: auditEvents.webLoginLocked,
  sessions_revoked: auditEvents.webSessionsRevoked,
  other_sessions_revoked: auditEvents.webOtherSessionsRevoked,
  two_factor_enabled: auditEvents.webTwoFactorEnabled,
  two_factor_disabled: auditEvents.webTwoFactorDisabled,
  backup_codes_generated: auditEvents.webBackupCodesGenerated,
  backup_code_used: auditEvents.webBackupCodeUsed,
  two_factor_locked: auditEvents.webTwoFactorLocked,
  two_factor_refused: auditEvents.webTwoFactorRefused,
} satisfies Record<AuthEventKind, string>;

// D4: a login or a password change is a row in the audit log of the user's oldest organization. It never throws.
export function auditWebEvent(db: Db): AuthDeps["onEvent"] {
  return async (kind, userId, data) => {
    try {
      const [membership] = await listMembershipsOfUser(db, userId);
      if (!membership) {
        log.warn("web_no_organization", { user_id: userId });
        return;
      }
      await recordAudit(
        db,
        { orgId: membership.org_id },
        { event: eventNames[kind], actor: userId, data: { via: "web", ...data } }
      );
    } catch (error) {
      log.error("web_audit_failed", { kind, ...errorFields(error) });
    }
  };
}

// F119: an SSO sign-in or refusal is a row in the provider's organization. `ssoPlugins` catches a failure and logs it.
export function auditSsoEvent(db: Db): NonNullable<AuthDeps["onSsoEvent"]> {
  return async (event) => {
    await recordAudit(
      db,
      { orgId: event.orgId },
      {
        event: event.kind === "login" ? auditEvents.ssoLogin : auditEvents.ssoRefused,
        actor: event.userId ?? "system",
        data: event.data,
      }
    );
  };
}

// L16: the accepted terms and their audit row go in one transaction, in the user's oldest organization. It never throws.
export function termsAcceptedHandler(db: Db, now: () => Date): AuthDeps["onTermsAccepted"] {
  return async (userId, version) => {
    try {
      const [membership] = await listMembershipsOfUser(db, userId);
      await db.transaction().execute(async (trx) => {
        await setUserTerms(trx, userId, version, now());
        if (membership) {
          await recordAudit(
            trx,
            { orgId: membership.org_id },
            { event: auditEvents.webTermsAccepted, actor: userId, data: { via: "web", version } }
          );
        }
      });
    } catch (error) {
      log.error("terms_record_failed", { user_id: userId, ...errorFields(error) });
    }
  };
}

// L7: a failed auth mail is an operator notice in the user's oldest organization. It never throws.
export function authMailFailedHandler(
  db: Db,
  notify: WebExtras["onAuthMailFailed"]
): (userId: string, kind: AuthMailKind, code: string) => void {
  return (userId, kind, code) => {
    if (!notify) return;
    void (async () => {
      try {
        const [membership] = await listMembershipsOfUser(db, userId);
        if (!membership) return;
        notify({ orgId: membership.org_id }, userId, kind, code);
      } catch (error) {
        log.error("web_auth_mail_notice_failed", { user_id: userId, ...errorFields(error) });
      }
    })();
  };
}

export type WebRuntime = WebDeps & { close(): Promise<void> };

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function scopeInfos(config: Config): TenancyRouteDeps["scopes"] {
  return {
    triage: scopeInfoOf("triage", config.TRIAGE_LLM_SCOPE),
    actions: scopeInfoOf("actions", config.ACTIONS_SCOPE),
    send: scopeInfoOf("send", config.SEND_SCOPE),
  };
}

export function scopeEnvOf(config: Config): ScopeEnv {
  return {
    triage: config.TRIAGE_LLM_SCOPE,
    actions: config.ACTIONS_SCOPE,
    send: config.SEND_SCOPE,
  };
}

export function countMailboxes(db: Db): TenancyRouteDeps["countMailboxes"] {
  return async (ctx) => {
    const rows = await listMailboxes(db, ctx);
    return { total: rows.length, inAuthError: rows.filter((row) => row.status === "auth_error").length };
  };
}

// F102 ticket: the badge of the nav. 0 while the flag `approvals_page` is off; `tenancy` gets it as a function (it must not import `actions`).
export function approvalsWaiting(db: Db): TenancyRouteDeps["approvalsWaiting"] {
  return async (ctx) => ((await isFeatureOn(db, ctx, "approvals_page")) ? countWaitingApprovals(db, ctx) : 0);
}

// D15: the Telegram item is per user, the others per organization.
export function onboardingDeps(
  db: Db,
  botUsername: (() => Promise<string>) | null
): Pick<TenancyRouteDeps, "onboarding" | "telegram" | "keepMode"> {
  const linked = async (ctx: TenantContext, userId: string) =>
    (await getChatLinkForUser(db, ctx, userId)) !== undefined;
  return {
    onboarding: async (ctx, userId) =>
      onboardingOf({
        mailboxCount: (await listMailboxes(db, ctx)).length,
        telegramLinked: await linked(ctx, userId),
        telegramAvailable: botUsername !== null,
        modeChosen: await hasAuditEvent(db, ctx, [auditEvents.mailboxModeChanged, auditEvents.onboardingModeKept]),
        ruleCount: await countSenderRules(db, ctx),
      }),
    telegram: async (ctx, userId) => ({
      available: botUsername !== null,
      linked: await linked(ctx, userId),
      botUsername: botUsername ? await botUsername().catch(() => null) : null,
    }),
    keepMode: async (ctx, userId, now) => {
      await recordAuditOnce(db, ctx, {
        actor: userId,
        event: auditEvents.onboardingModeKept,
        data: { via: "web" },
        at: now,
      });
    },
  };
}

// `botUsername` only tells whether Telegram is on: a server without a bot never blocks `done` (B2).
export function homePathOf(
  db: Db,
  botUsername: (() => Promise<string>) | null = null
): NonNullable<WebDeps["homePath"]> {
  return async (userId) => {
    const [membership] = await listMembershipsOfUser(db, userId);
    if (!membership) return "/onboarding";
    const ctx = { orgId: membership.org_id };
    const state = await onboardingDeps(db, botUsername).onboarding(ctx, userId);
    return state.done ? "/activity" : "/onboarding";
  };
}

// D8, D16: the web calls the same setters as the CLI, with the one `settingsDeps` builder.
export function settingsRouteDeps(db: Db, now: () => Date, testMail: TestMailRule): SettingsRouteDeps {
  const settings = settingsDeps(db, now);
  return {
    db,
    now,
    settings,
    goNoGo: (ctx, id, at) => goNoGoFor(db, ctx, id, at, testMail),
    setAuto: async (ctx, id, input) => {
      const result = await setCategoryAutoWithGate(settings, ctx, id, input, testMail);
      return result.kind === "refused" ? result : { kind: "changed", change: result.change };
    },
    listSyncFolders: async (ctx, id) =>
      (await listSyncFolders(db, ctx, id, { enabledOnly: false })).map(({ key, role, path, enabled }) => ({
        key,
        role,
        path,
        enabled,
      })),
    setSyncFolder: (ctx, id, input) =>
      setSyncFolderEnabled(db, ctx, id, input.key, input.enabled, input.actor, input.now),
    getSentSync: (ctx, id) => getSentSyncView(db, ctx, id, now()),
    setSentSync: async (ctx, id, input) =>
      (await setSentSync(db, ctx, id, { enabled: input.enabled, actor: input.actor, at: input.now }, sentSwitchHooks))
        .result,
  };
}

export function distPath(config: Config, cwd = process.cwd()): string {
  return resolve(cwd, config.WEB_DIST);
}

// @hono/bun throws without the Bun server (app.request in tests).
export function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export interface WebExtras {
  secrets: SecretBox;
  actionsScope: ActionsScope;
  sendScope: SendScope;
  botUsername: (() => Promise<string>) | null; // null: Telegram is off
  /** Default: the clients of the config (`createMailOAuthClients`). A test passes clients that point at the fake token server. */
  mailOAuthClients?: MailOAuthClients;
  /** Default: the IMAP and SMTP adapters. A test passes a login that refuses (the callback tests). `oauthTokens` is the cache the Reconnect drops. */
  mailOAuthLogin?: Partial<Pick<ApplyGrantDeps, "openProvider" | "verifySmtp" | "oauthTokens">>;
  onAuthMailFailed?: (ctx: TenantContext, userId: string, kind: AuthMailKind, code: string) => void;
}

export function apiRouters(
  config: Config,
  db: Db,
  extras: WebExtras,
  now: () => Date,
  sessions: TenancyRouteDeps["sessions"],
  backupCodes: TenancyRouteDeps["backupCodesLeft"],
  privacy: Omit<PrivacyRouteDeps, "db" | "now">
): NonNullable<WebDeps["routers"]> {
  const scopes = scopeInfos(config);
  const allowLocalHosts = mailAllowLocal(config);
  return (api) => {
    api.route(
      "/",
      tenancyRoutes({
        db,
        now,
        scopes,
        countMailboxes: countMailboxes(db),
        approvalsWaiting: approvalsWaiting(db),
        operatorContact: config.OPERATOR_CONTACT ?? null,
        sessions,
        backupCodesLeft: backupCodes,
        ...onboardingDeps(db, extras.botUsername),
      })
    );
    api.route("/", privacyRoutes({ db, now, ...privacy }));
    api.route("/operator", operatorRoutes({ db, now, planHooks: orgPlanHooks(db) }));
    api.route(
      "/",
      mailRoutes({
        db,
        now,
        scopeEnv: scopeEnvOf(config),
        connect: {
          db,
          secrets: extras.secrets,
          openProvider: openImapProvider,
          verifySmtp: verifySmtpLogin,
          timeouts: WEB_MAIL_TIMEOUTS,
        },
        allowLocalHosts,
        onRemoved: async (trx, ctx, input) => {
          await queueMailboxRemovedNotices(trx, ctx, input);
        },
        oauth: {
          secrets: extras.secrets,
          clients: extras.mailOAuthClients ?? createMailOAuthClients(config),
          ...(extras.mailOAuthLogin?.oauthTokens === undefined ? {} : { tokens: extras.mailOAuthLogin.oauthTokens }),
        },
      })
    );
    api.route(
      "/",
      mailOAuthRoutes({
        db,
        now,
        secrets: extras.secrets,
        clients: extras.mailOAuthClients ?? createMailOAuthClients(config),
      })
    );
    api.route("/", settingsRoutes(settingsRouteDeps(db, now, testMailRule(config))));
    api.route("/", rulesRoutes({ db, now }));
    api.route("/", activityRoutes({ db, now }));
    api.route("/", statsRoutes({ db, now, urgentNotices: listUrgentNoticeTimes, testMail: testMailRule(config) }));
    api.route("/", triageRoutes({ db, now, actionsScope: extras.actionsScope }));
    api.route("/", actionRoutes({ db, now }));
    api.route("/", channelRoutes({ db, now, botUsername: extras.botUsername }));
    api.route(
      "/",
      approvalRoutes({ db, now, sendScope: extras.sendScope, hooks: delegationHooks({ db }), uidplus: uidplusOf(db) })
    );
    api.route("/", delegateRoutes({ db, now }));
    api.route(
      "/",
      delegationRoutes({
        db,
        now,
        approvalHooks: cardEditHooks({ sendScope: extras.sendScope }),
        uidplus: uidplusOf(db),
      })
    );
  };
}

// The routes before the session guard (`WebDeps.publicRouters`): the provider redirect of the mailbox OAuth flow answers 303 to
// `/login` without a session, so it cannot sit behind `requireSession`. The route reads the session and enters the tenant scope itself.
export function apiPublicRouters(
  config: Config,
  db: Db,
  extras: WebExtras,
  now: () => Date
): NonNullable<WebDeps["publicRouters"]> {
  return (api) => {
    api.route(
      "/",
      mailOAuthCallbackRoutes({
        db,
        now,
        secrets: extras.secrets,
        clients: extras.mailOAuthClients ?? createMailOAuthClients(config),
        openProvider: openImapProvider,
        verifySmtp: verifySmtpLogin,
        timeouts: WEB_MAIL_TIMEOUTS,
        ...extras.mailOAuthLogin,
      })
    );
  };
}

// null: the web is off.
export function webDeps(config: Config, db: Db, extras: WebExtras): WebRuntime | null {
  if (config.WEB_BASE_URL === undefined) {
    log.info("web_off", { config_key: "WEB_BASE_URL" });
    return null;
  }
  const baseUrl = new URL(config.WEB_BASE_URL);
  if (baseUrl.protocol === "http:" && !LOOPBACK_HOSTS.includes(baseUrl.hostname)) {
    log.warn("web_cookies_not_secure", { config_key: "WEB_BASE_URL" });
  }
  const origins = [baseUrl.origin, ...webTrustedOrigins(config)];
  const settings = authMailSettings(config);
  const mailer = settings === null ? null : createAuthMailer(settings);
  const mailTasks =
    mailer === null
      ? null
      : createAuthMailTasks({
          mailer,
          localeOf: async (userId) => (await getUserAuthProfile(db, userId))?.locale ?? "pl",
          onFailed: authMailFailedHandler(db, extras.onAuthMailFailed),
        });
  if (mailTasks === null) log.info("auth_mail_off");
  else log.info("auth_mail_on");
  if (config.AUTH_PWNED_CHECK === "off") log.warn("pwned_check_off", { config_key: "AUTH_PWNED_CHECK" });
  const lockout = createLockoutStore(db);
  const onEvent = auditWebEvent(db);
  const sendLockoutMail: AuthDeps["sendLockoutMail"] =
    mailTasks === null
      ? undefined
      : ({ userId, email }) => {
          mailTasks.start({ kind: "lockout", userId, to: email, url: `${baseUrl.origin}/forgot` });
        };
  const handle = createAuth({
    databaseUrl: config.DATABASE_URL,
    baseUrl: config.WEB_BASE_URL,
    secret: config.WEB_AUTH_SECRET ?? "", // the config check guarantees it
    trustedOrigins: origins,
    onEvent,
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 3_600,
    lockout,
    keepsTwoFactor: (userId) => isBreakGlassOwner(db, userId),
    passwordSignInRefused: (userId) => isPasswordSignInRefused(db, userId),
    resolveSsoMember: (identity) => resolveSsoMember(db, identity),
    onSsoEvent: auditSsoEvent(db),
    ...(config.AUTH_PWNED_CHECK === "on"
      ? { pwnedCheck: (password: string) => checkPwnedPassword(password, { fetch, timeoutMs: 5_000 }) }
      : {}),
    sendLockoutMail,
    sendResetPassword:
      mailTasks === null
        ? undefined
        : async ({ userId, email, url }) => {
            mailTasks.start({ kind: "reset", userId, to: email, url });
          },
  });
  const dist = distPath(config);
  const now = () => new Date();

  const getSession = async (headers: Headers): Promise<WebSession | null> => {
    const response = await handle.auth.api.getSession({ headers, returnHeaders: true });
    if (!response?.response) return null;
    return {
      userId: response.response.user.id,
      sessionId: response.response.session.id,
      twoFactorEnabled: response.response.user.twoFactorEnabled === true,
      signInMethod: signInMethodOf(response.response.session.signInMethod),
      setCookie: response.headers.getSetCookie(),
    };
  };

  const operators = operatorUserIds(config);
  log.info("web_operators", { count: operators.size });
  log.info("web_on");
  return {
    auth: { handler: (req) => handle.auth.handler(req), getSession },
    db,
    now,
    dist,
    baseUrl,
    trustedOrigins: new Set(origins),
    trustedProxies: buildTrustedProxies(webTrustedProxies(config)),
    connInfo: peerAddress,
    listMembershipsOfUser: (userId) => listMembershipsOfUser(db, userId),
    homePath: homePathOf(db, extras.botUsername),
    publicRouters: apiPublicRouters(config, db, extras, now),
    routers: apiRouters(
      config,
      db,
      extras,
      now,
      (userId) => listUserSessions(handle, userId),
      (userId) => backupCodesLeft(handle, userId),
      {
        lockout,
        onEvent,
        sendLockoutMail,
        verifyPassword: (headers, password) => verifyOwnPassword(handle, headers, password),
        expiredSessionCookie: () => expiredSessionCookie(handle),
      }
    ),
    operatorUserIds: operators,
    isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
    anySsoUsable: () => anySsoUsable(db),
    resetRequestOpen: mailTasks !== null,
    close: async () => {
      if (mailTasks !== null) {
        await Promise.race([mailTasks.idle(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
      }
      await handle.close();
    },
  };
}
