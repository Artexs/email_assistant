import type { GateEvidenceDeps } from "@ea/core";

import { orgPlanHooks, settingsDeps, uidplusOf } from "./composition";
import { actionRoutes, type ActionsScope, type SendScope } from "./modules/actions";
import {
  approvalRoutes,
  cardEditHooks,
  channelRoutes,
  pushRoutes,
  queueMailboxRemovedNotices,
  replyApprovalRoutes,
} from "./modules/channels";
import { rulesRoutes, settingsRoutes } from "./modules/config";
import { suggestionRoutes } from "./modules/contacts";
import { delegateRoutes, delegationHooks, delegationRoutes } from "./modules/delegation";
import { loopRoutes } from "./modules/loops";
import {
  WEB_MAIL_TIMEOUTS,
  createMailOAuthClients,
  mailOAuthCallbackRoutes,
  mailOAuthRoutes,
  mailRoutes,
  openImapProvider,
  verifySmtpLogin,
  type ApplyGrantDeps,
  type MailOAuthClients,
} from "./modules/mail";
import { operatorRoutes } from "./modules/operator";
import { privacyRoutes, type PrivacyRouteDeps } from "./modules/privacy";
import { replyRoutes, type ReplySampleScope, type StylePreview } from "./modules/replies";
import { activityRoutes, statsRoutes } from "./modules/reports";
import { tenancyRoutes, type TenancyRouteDeps } from "./modules/tenancy";
import { newsletterRoutes, reviewRoutes, triageRoutes } from "./modules/triage";
import { queueHistoryCheckOnConnect, trustRoutes } from "./modules/trust";
import type { AuthMailKind } from "./platform/auth-mail-texts";
import { mailAllowLocal, mailTrustedAuthservIds, pushConfigOf, testMailRule, type Config } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { Db, TenantContext } from "./platform/db";
import type { WebDeps } from "./platform/http";
import { dnsLookupAll } from "./platform/net-address";
import { postOneClick, type OneClickResult } from "./platform/public-http";
import {
  approvalsWaiting,
  countMailboxes,
  onboardingDeps,
  scopeEnvOf,
  scopeInfos,
  settingsRouteDeps,
  statsRouteDeps,
} from "./web-route-deps";

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
  /** The global evidence of the running classifier, built once at start. Default: none (a closed gate; tests). */
  gate?: GateEvidenceDeps;
  /** Default: `postOneClick` with the system lookup (the guarded client). A test passes a fake: no test sends a real request. */
  postOneClick?: (url: URL) => Promise<OneClickResult>;
  /** The style preview of the reply drafts: one drafter call on a fixed sample mail. Absent or null: no model client runs, and a preview answers `failed`. */
  stylePreview?: StylePreview | null;
  /** The clock and the model scope of the sample drafts of the reply drafts. Absent or null: no model client runs, and a sample run answers 409 `llm_off`. */
  replySamples?: ReplySampleScope | null;
  /** Default: the global `fetch`. The only way out to a push service (the test notice). A test passes a fake that answers on the loopback. */
  pushFetch?: typeof fetch;
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
          onConnected: queueHistoryCheckOnConnect(db),
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
    api.route("/", settingsRoutes(settingsRouteDeps(db, now, testMailRule(config), extras.gate)));
    api.route("/", trustRoutes({ settings: settingsDeps(db, now, extras.gate), testMail: testMailRule(config) }));
    api.route("/", replyRoutes({ db, preview: extras.stylePreview ?? null, samples: extras.replySamples ?? null }));
    api.route("/", rulesRoutes({ db, now }));
    api.route("/", suggestionRoutes({ db, now, testMail: testMailRule(config) }));
    api.route("/", activityRoutes({ db, now, sender: { db, credentialsKey: config.CREDENTIALS_KEY } }));
    api.route("/", statsRoutes(statsRouteDeps(db, now, testMailRule(config), extras.gate)));
    api.route("/", triageRoutes({ db, now, actionsScope: extras.actionsScope }));
    api.route("/", reviewRoutes({ db, now, testMail: testMailRule(config) }));
    api.route(
      "/",
      newsletterRoutes({
        db,
        now,
        trustedAuthservIds: mailTrustedAuthservIds(config),
        post: extras.postOneClick ?? ((url) => postOneClick(url, { lookup: dnsLookupAll })),
      })
    );
    api.route("/", actionRoutes({ db, now }));
    api.route("/", channelRoutes({ db, now, botUsername: extras.botUsername }));
    api.route(
      "/",
      pushRoutes({ db, now, box: extras.secrets, keys: pushConfigOf(config), fetch: extras.pushFetch ?? fetch })
    );
    api.route(
      "/",
      approvalRoutes({
        db,
        now,
        sendScope: extras.sendScope,
        hooks: delegationHooks({ db }),
        uidplus: uidplusOf(db),
        sender: { db, credentialsKey: config.CREDENTIALS_KEY },
      })
    );
    api.route(
      "/",
      replyApprovalRoutes({
        db,
        now,
        sendScope: extras.sendScope,
        hooks: delegationHooks({ db }),
        uidplus: uidplusOf(db),
      })
    );
    api.route("/", delegateRoutes({ db, now }));
    api.route("/", loopRoutes({ db, now }));
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
        onConnected: queueHistoryCheckOnConnect(db),
        ...extras.mailOAuthLogin,
      })
    );
  };
}
