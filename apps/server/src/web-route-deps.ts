import { resolve } from "node:path";

import { onboardingOf, scopeInfoOf, type GateEvidenceDeps, type ScopeEnv } from "@ea/core";
import { getConnInfo } from "@hono/bun";
import type { Context } from "hono";

import { autoSetter, sentSwitchHooks, settingsDeps, trustEvidenceOf } from "./composition";
import { countWaitingApprovals } from "./modules/actions";
import { auditEvents, hasAuditEvent, recordAuditOnce } from "./modules/audit";
import { getChatLinkForUser, listUrgentNoticeTimes } from "./modules/channels";
import { countSenderRules, type SettingsRouteDeps } from "./modules/config";
import {
  getSentSyncView,
  listMailboxes,
  listSyncFolders,
  setSentSync,
  setSyncFolderEnabled,
  type TestMailRule,
} from "./modules/mail";
import type { StatsRouteDeps } from "./modules/reports";
import { getMemberNotify, isFeatureOn, listMembershipsOfUser, type TenancyRouteDeps } from "./modules/tenancy";
import { goNoGoFor } from "./modules/triage";
import { hasEndedCheck } from "./modules/trust";
import type { Config } from "./platform/config";
import type { Db, TenantContext } from "./platform/db";
import type { WebDeps } from "./platform/http";

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

// The badge of the nav. 0 while the flag `approvals_page` is off; `tenancy` gets it as a function (it must not import `actions`).
export function approvalsWaiting(db: Db): TenancyRouteDeps["approvalsWaiting"] {
  return async (ctx) => ((await isFeatureOn(db, ctx, "approvals_page")) ? countWaitingApprovals(db, ctx) : 0);
}

// With `trust_ladder` on, onboarding asks for a channel (per user) and a finished history check (per organization).
// `null`: the flag is off and onboarding is as before. The member row and the check are read with the organization of the caller only.
async function trustOnboardingOf(
  db: Db,
  ctx: TenantContext,
  userId: string
): Promise<{ reportByMail: boolean; reportReady: boolean } | null> {
  if (!(await isFeatureOn(db, ctx, "trust_ladder"))) return null;
  const notify = await getMemberNotify(db, ctx, userId);
  return {
    reportByMail: notify !== undefined && notify.report_channel !== "telegram",
    reportReady: await hasEndedCheck(db, ctx),
  };
}

// The Telegram item is per user, the others per organization.
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
        trust: await trustOnboardingOf(db, ctx, userId),
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

// `botUsername` only tells whether Telegram is on: a server without a bot never blocks `done`.
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

// The stats route reads the three evidence sources of M8 through the trust reader. `reports` may not import `trust`,
// so this root passes the reader.
export function statsRouteDeps(
  db: Db,
  now: () => Date,
  testMail: TestMailRule,
  gate?: GateEvidenceDeps
): StatsRouteDeps {
  return {
    db,
    now,
    urgentNotices: listUrgentNoticeTimes,
    testMail,
    trustEvidence: trustEvidenceOf(db, now, gate, testMail),
  };
}

// The web calls the same setters as the CLI, with the one `settingsDeps` builder.
export function settingsRouteDeps(
  db: Db,
  now: () => Date,
  testMail: TestMailRule,
  gate?: GateEvidenceDeps
): SettingsRouteDeps {
  const settings = settingsDeps(db, now, gate);
  const setAuto = autoSetter(settings, testMail);
  return {
    db,
    now,
    settings,
    goNoGo: (ctx, id, at) => goNoGoFor(db, ctx, id, at, testMail),
    setAuto: async (ctx, id, input) => {
      const result = await setAuto(ctx, id, input);
      return result.kind === "refused"
        ? { kind: "refused", gate: result.gate, ...(result.evidence ? { blocks: result.evidence.blocks } : {}) }
        : { kind: "changed", change: result.change };
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
