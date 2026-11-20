import { featureKeys, type FeatureKey, type Scenario } from "@ea/core";

import type { Db } from "../../platform/db";
import { createLinkToken, getChatLinkForUser } from "../channels";
import { addSenderRule, getMailboxSettings, setMode, type SettingsDeps } from "../config";
import { addDelegate } from "../delegation";
import { connectMailbox, listMailboxes, type ConnectDeps } from "../mail";
import { createOrganizationWithOwner, getOrganization, listMemberships, setOrgFeature } from "../tenancy";

import { LAB_MAILBOXES } from "./corpus";
import type { FakeTgClient } from "./fake-tg";
import type { LabOrg, LabOrgKey, LabState } from "./state";

// The mail host of every lab mailbox is the loopback address 127.0.0.1, and nothing else. In the sim stack GreenMail
// joins the network namespace of `fake-telegram`, like `server` and `lab` (`deploy/compose.sim.yaml`), so it is on
// 127.0.0.1. The server opens plain IMAP and SMTP only to a loopback host: a service name such as `greenmail` would get
// TLS on a plain port. The env guard (`checkSimEnv`) does not check mailbox hosts: only this constant keeps a lab
// mailbox off a real mail server. Seed never takes a host from the command line, the env or a file. The injector and the
// delegate bots (later stages) run in the `lab` container, in the same namespace, and use the same host.
export const LAB_MAIL_HOST = "127.0.0.1";
export const LAB_IMAP_PORT = 3143;
export const LAB_SMTP_PORT = 3025;
// GreenMail runs with auth off: any password logs in. Not a secret.
export const LAB_MAIL_PASSWORD = "greenmail-test";
const TIME_ZONE = "Europe/Warsaw";
const ACTOR = "cli";

export interface SeedTarget {
  key: LabOrgKey;
  orgName: string;
  mailbox: string;
  mode: "shadow" | "assist";
  // The fake Telegram chat of the owner (a private chat: the chat id is the user id).
  chatId: number;
}

export const LAB_TARGETS: Record<LabOrgKey, SeedTarget> = {
  lab: { key: "lab", orgName: "Kordelan lab", mailbox: LAB_MAILBOXES.lab, mode: "assist", chatId: 5550001 },
  demo: { key: "demo", orgName: "Kordelan demo", mailbox: LAB_MAILBOXES.demo, mode: "shadow", chatId: 5550002 },
};

// Every key of `packages/core/src/features.ts` is in exactly one list. `mistake_capture` is on: the executive needs the
// reason buttons. `org_delete`, `sso_sign_in` and the two `mail_oauth_*` flags stay off: the lab org has no delete through the panel (`lab reset` deletes it through the operator function, with its own guards), no SSO and no OAuth mailbox (its mailbox is a GreenMail password login). `open_loops` and `delegate_button` stay off until the loop stages are built and the pilot turns them on. `trust_ladder` stays off until the evidence stages of the same epic are built; the pilot turns it on. `panel_review` stays off until the owner asks: the lab run labels nothing through the panel. `why_lines` stays off until the owner asks. `docs_links` stays off until the docs site is live. `user_quiet_hours` and `report_mail` stay off: the lab run has fixed notice times and no report mail, and the pilot turns them on per member. `urgency_editor` is on: its server side exists, and the lab run writes the profile the card shows. `spam_review_line` stays off until the pilot turns it on. `bulk_unsubscribe` stays off until the one-click stage is built and the pilot turns it on. `reply_drafts` stays off until the reply stages are built and the pilot turns it on. `draft_copy_check` stays off until the pilot turns it on after the copy probe. `style_from_sent` stays off until the judged eval of the suggested style passes. `sender_context`, `contact_wait` and `sender_suggestions` stay off until the sender-context readers exist and the pilot turns them on. `web_push` stays off: the lab run has no phone and no push service, and the pilot turns it on after the sender stages of the phone channel ticket. `telegram_minimal` stays off for the same reason: the lab run reads its Telegram messages in full.
export const LAB_FLAGS_OFF = [
  "org_delete",
  "sso_sign_in",
  "mail_oauth_microsoft",
  "mail_oauth_google",
  "open_loops",
  "delegate_button",
  "trust_ladder",
  "panel_review",
  "why_lines",
  "docs_links",
  "user_quiet_hours",
  "report_mail",
  "spam_review_line",
  "bulk_unsubscribe",
  "reply_drafts",
  "draft_copy_check",
  "style_from_sent",
  "sender_context",
  "contact_wait",
  "sender_suggestions",
  "web_push",
  "telegram_minimal",
] as const satisfies readonly FeatureKey[];
export const LAB_FLAGS_ON = [
  "stats_page",
  "approvals_page",
  "delegation_pages",
  "sent_sync",
  "security_log",
  "review_command",
  "mistake_capture",
  "llm_pause_line",
  "weekly_report",
  "handled_share",
  "answered_check",
  "suspicious_mail",
  "attachment_line",
  "degraded_notice",
  "urgency_editor",
] as const satisfies readonly FeatureKey[];

/** The keys that are in neither list. A new flag fails the lab test until a person puts it in a list. */
export function unlistedFlags(keys: readonly string[] = featureKeys): string[] {
  const listed = new Set<string>([...LAB_FLAGS_ON, ...LAB_FLAGS_OFF]);
  return keys.filter((key) => !listed.has(key));
}

export type SeedErrorCode = "org_gone" | "telegram_link_timeout";

export class LabSeedError extends Error {
  constructor(readonly code: SeedErrorCode) {
    super(code);
    this.name = "LabSeedError";
  }
}

export interface SeedDeps {
  db: Db;
  connect: ConnectDeps;
  settings: SettingsDeps;
  state: LabState;
  tg: FakeTgClient;
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** How long seed waits for the server to link the chat after `/start`. */
  linkTimeoutMs: number;
  pollMs: number;
}

// What this run added. A second run on a whole org adds nothing: every count is 0 and `relinked` is false.
export interface SeedAdded {
  mailbox: number;
  delegates: number;
  rules: number;
  flags: number;
  linked: boolean;
  relinked: boolean;
}

export interface SeedResult {
  org: LabOrg;
  created: boolean;
  added: SeedAdded;
}

const personaOf = (scenario: Scenario, key: string) => {
  const persona = scenario.personas.find((candidate) => candidate.key === key);
  if (persona === undefined) throw new Error(`lab seed: scenario persona ${key} is missing`);
  return persona;
};

async function waitForLink(deps: SeedDeps, ctx: { orgId: string }, userId: string): Promise<boolean> {
  const deadline = deps.now().getTime() + deps.linkTimeoutMs;
  for (;;) {
    if ((await getChatLinkForUser(deps.db, ctx, userId)) !== undefined) return true;
    if (deps.now().getTime() >= deadline) return false;
    await deps.sleep(deps.pollMs);
  }
}

/**
 * Makes the lab organization of `target` from the scenario, or repairs it. The first call creates the org, the owner,
 * the mailbox, the delegates, the VIP rules, the mode, the flags and the fake Telegram link. A later call (the org is
 * in `orgs.json`) checks each part and adds what is missing; it never makes a second org.
 *
 * `orgs.json` is written after the mailbox exists and before the Telegram step: a crash in the Telegram step leaves
 * one org, and the next call tries the link again.
 */
export async function seedLabOrg(deps: SeedDeps, scenario: Scenario, target: SeedTarget): Promise<SeedResult> {
  const { db, state } = deps;
  const added: SeedAdded = { mailbox: 0, delegates: 0, rules: 0, flags: 0, linked: false, relinked: false };
  const known = state.readOrgs()[target.key];

  // The owner email is the mailbox address: it is the executive address for `lab`, and `users.email` is unique, so
  // `demo` needs its own.
  let orgId: string;
  let userId: string;
  if (known === undefined) {
    const created = await createOrganizationWithOwner(db, {
      orgName: target.orgName,
      timezone: TIME_ZONE,
      email: target.mailbox,
      displayName: scenario.executive.displayName,
      plan: { kind: "active" },
    });
    ({ orgId, userId } = created);
  } else {
    if ((await getOrganization(db, { orgId: known.orgId })) === undefined) throw new LabSeedError("org_gone");
    const owner = (await listMemberships(db, { orgId: known.orgId })).find((member) => member.role === "owner");
    if (owner === undefined) throw new Error("lab seed: the lab org has no owner");
    ({ orgId } = known);
    userId = owner.user_id;
  }
  const ctx = { orgId };

  // Mailbox: a deleted row is connected again.
  let mailboxId = (await listMailboxes(db, ctx)).find((row) => row.address === target.mailbox)?.id;
  if (mailboxId === undefined) {
    ({ mailboxId } = await connectMailbox(deps.connect, ctx, {
      address: target.mailbox,
      password: LAB_MAIL_PASSWORD,
      secretKind: "password",
      imapHost: LAB_MAIL_HOST,
      imapPort: LAB_IMAP_PORT,
      smtpHost: LAB_MAIL_HOST,
      smtpPort: LAB_SMTP_PORT,
    }));
    added.mailbox = 1;
  }
  const org: LabOrg = { orgId, mailboxId, address: target.mailbox, chatId: target.chatId };
  if (known === undefined || JSON.stringify(known) !== JSON.stringify(org)) {
    state.writeOrgs({ ...state.readOrgs(), [target.key]: org });
  }

  for (const { persona, tags } of scenario.delegates) {
    const { displayName, address } = personaOf(scenario, persona);
    const result = await addDelegate(db, ctx, {
      name: displayName,
      email: address,
      tags: [...tags],
      actor: ACTOR,
      via: "cli",
      now: deps.now(),
    });
    if (result.kind === "added") added.delegates += 1;
    else if (result.kind !== "exists") throw new Error(`lab seed: delegate ${persona} refused (${result.kind})`);
  }

  for (const key of scenario.urgency.vip) {
    const result = await addSenderRule(db, ctx, {
      mailboxId,
      pattern: personaOf(scenario, key).address,
      kind: "vip",
      actor: ACTOR,
      now: deps.now(),
    });
    if (result.kind === "added") added.rules += 1;
    else if (result.kind !== "exists") throw new Error(`lab seed: vip rule ${key} refused (${result.kind})`);
  }

  // The mode change also sets the default switches of the mode, so a repair run changes the mode only when it differs.
  const settings = await getMailboxSettings(db, ctx, mailboxId);
  if (settings?.mode !== target.mode) {
    await setMode(deps.settings, ctx, mailboxId, { mode: target.mode, keepSwitches: false, actor: ACTOR });
  }

  for (const flag of LAB_FLAGS_ON) {
    const result = await setOrgFeature(db, ctx, { flag, enabled: true, actor: ACTOR, now: deps.now() });
    if (result.kind === "changed") added.flags += 1;
    else if (result.kind !== "unchanged") throw new Error(`lab seed: flag ${flag} refused (${result.kind})`);
  }

  // The link needs the DB row and the chat in the fake. A restarted fake has no chat: it knows a chat after the first
  // user message, so `/help` from the linked chat makes it known again. The server holds the link and sends no `/start`.
  const link = await getChatLinkForUser(db, ctx, userId);
  if (link === undefined) {
    const { token } = await createLinkToken(db, ctx, userId, deps.now());
    await deps.tg.send(target.chatId, `/start ${token}`);
    if (!(await waitForLink(deps, ctx, userId))) throw new LabSeedError("telegram_link_timeout");
    added.linked = true;
  } else if (!(await deps.tg.hasChat(link.chatId))) {
    await deps.tg.send(link.chatId, "/help");
    added.relinked = true;
  }

  return { org, created: known === undefined, added };
}
