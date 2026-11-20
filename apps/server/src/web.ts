import {
  anySsoUsable,
  getUserAuthProfile,
  isBreakGlassOwner,
  isOrgSuspended,
  isPasswordSignInRefused,
  isSsoOnlyMember,
  listMembershipsOfUser,
  resolveSsoMember,
} from "./modules/tenancy";
import { createAuth, expiredSessionCookie, listUserSessions, verifyOwnPassword, type AuthDeps } from "./platform/auth";
import { createLockoutStore } from "./platform/auth-lockout";
import { createAuthMailTasks, createAuthMailer } from "./platform/auth-mail";
import { backupCodesLeft } from "./platform/auth-two-factor";
import {
  authMailSettings,
  operatorUserIds,
  webTrustedOrigins,
  webTrustedProxies,
  type Config,
} from "./platform/config";
import type { Db } from "./platform/db";
import { buildTrustedProxies, signInMethodOf, type WebDeps, type WebSession } from "./platform/http";
import { checkPwnedPassword } from "./platform/pwned";
import { auditSsoEvent, auditWebEvent, authMailFailedHandler, log, termsAcceptedHandler } from "./web-audit";
import { distPath, homePathOf, peerAddress } from "./web-route-deps";
import { apiPublicRouters, apiRouters, type WebExtras } from "./web-routers";

export { auditSsoEvent, auditWebEvent, authMailFailedHandler, termsAcceptedHandler } from "./web-audit";
export {
  approvalsWaiting,
  countMailboxes,
  distPath,
  homePathOf,
  onboardingDeps,
  peerAddress,
  scopeEnvOf,
  scopeInfos,
  settingsRouteDeps,
  statsRouteDeps,
} from "./web-route-deps";
export { apiPublicRouters, apiRouters, type WebExtras } from "./web-routers";

export type WebRuntime = WebDeps & { close(): Promise<void> };

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

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
    ssoOnlyMember: (userId) => isSsoOnlyMember(db, userId),
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
