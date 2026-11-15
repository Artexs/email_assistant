import {
  actionStatusFor,
  cleanUserText,
  decidePolicy,
  markUntrustedText,
  parseToolSwitches,
  planActions,
  sendPayloadFor,
  TASK_MAX_CHARS,
  textsFor,
  type PlannedAction,
} from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import {
  createPlanned,
  isOwnActionId,
  listSummaries,
  setDelegationId,
  type CreatedAction,
  type PlannedActionInput,
} from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";
import { countDelegationsOfEmail, createDelegation, findOpenDelegationOfEmail, lockDelegate } from "../delegation";
import { getEmailMeta, listMailboxes, lockEmail, type EmailMeta } from "../mail";
import { getMembership, getOrganization, isFeatureOn } from "../tenancy";
import { latestTriageResult, suspiciousReasonsOf } from "../triage";

export type DelegateMailVia = "web" | "telegram" | "cli";

export interface DelegateMailDeps {
  db: Db | Transaction<DB>;
  now(): Date;
}

export type DelegateMailResult =
  | { kind: "planned"; sendId: string; delegationId: string }
  | { kind: "exists"; delegationId: string }
  | { kind: "delegate_inactive" }
  | { kind: "drafts_off" }
  | { kind: "not_delegable" }
  | { kind: "not_allowed" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

// The Message-ID of a mail of the system: `<ea-<draft action id>@<domain>>` (`drafts-and-send.md` rule 1).
const SYSTEM_MESSAGE_ID = /^<ea-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@[^<>\s]+>$/i;
const languageSchema = z.enum(["pl", "en", "other"]);

// The task text of a delegation that the user starts by hand: the stored triage summary of the mail, else its subject
// (no LLM call). Both are mail text: the marking removes addresses, links and long numbers; line breaks go; the text
// is cut to the task length of the classifier. A mail with neither gets the "no subject" word of the draft language.
export function delegateTaskText(
  summary: string | null | undefined,
  subject: string | null,
  language: "pl" | "en"
): string {
  for (const candidate of [summary, subject]) {
    if (candidate === undefined || candidate === null) continue;
    const text = cleanUserText(markUntrustedText(candidate), { oneLine: true }).slice(0, TASK_MAX_CHARS).trim();
    if (text !== "") return text;
  }
  return textsFor(language).common.noSubject;
}

// A mail that must not become a delegation: no triage result (the suspicion check has not run), the final category
// `spam`, a suspicious reason (PD-063), a sender that is an own mailbox, or a mail of the system itself.
async function delegable(trx: Transaction<DB>, ctx: TenantContext, email: EmailMeta): Promise<boolean> {
  const triage = await latestTriageResult(trx, ctx, email.id);
  if (triage === undefined || triage.category === "spam") return false;
  if ((await suspiciousReasonsOf(trx, ctx, [email.id])).has(email.id)) return false;
  const sender = email.from_address?.trim().toLowerCase();
  if (sender !== undefined && sender !== "") {
    const own = (await listMailboxes(trx, ctx)).some((mailbox) => mailbox.address.trim().toLowerCase() === sender);
    if (own) return false;
  }
  const systemId = SYSTEM_MESSAGE_ID.exec(email.message_id_header ?? "")?.[1];
  if (systemId !== undefined && (await isOwnActionId(trx, ctx, email.mailbox_id, systemId))) return false;
  return true;
}

// The user picks a delegate for a mail: the draft and the approval of a delegation that triage made (PD-124).
// The checks run in the order of the stage text. The first statement of the transaction share-locks the settings row
// (M13): a setter that turns drafts off waits for this call, or this call sees its commit. The recipient is the address
// of the `delegates` row; no mail text is a recipient. The send waits for a tap (ADR 0003). The caller says whether the
// user is an owner of the organization; this function checks it again and trusts no caller.
export async function delegateMail(
  deps: DelegateMailDeps,
  ctx: TenantContext,
  input: { emailId: string; delegateId: string; userId: string; via: DelegateMailVia }
): Promise<DelegateMailResult> {
  if (!(await isFeatureOn(deps.db, ctx, "delegate_button"))) return { kind: "feature_off" };
  const email = await getEmailMeta(deps.db, ctx, input.emailId);
  if (email === undefined) return { kind: "not_found" };
  const member = await getMembership(deps.db, ctx, input.userId);
  if (member?.role !== "owner") return { kind: "not_allowed" };

  const run = async (trx: Transaction<DB>): Promise<DelegateMailResult> => {
    const hasSettings = (await lockSettingsForShare(trx, ctx, email.mailbox_id)) !== undefined;
    // The mail row next, as `saveTriage` does: two picks of one mail, with the same or other delegates, run one after the
    // other. The second finds the open delegation of the first (`exists`). The delegate lock alone serializes one delegate.
    if (!(await lockEmail(trx, ctx, email.id))) return { kind: "not_found" };
    const checked = await checkMail(trx, ctx, email, input.delegateId);
    if (checked.kind === "stop") return checked.result;
    // The settings row is share-locked: the mode and the switches cannot change before the commit. No row: no drafts.
    const settings = hasSettings ? await getMailboxSettings(trx, ctx, email.mailbox_id) : undefined;
    return plan(trx, ctx, { email, delegate: checked.delegate, settings }, input, deps.now());
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}

type Checked =
  | { kind: "stop"; result: DelegateMailResult }
  | { kind: "go"; delegate: { id: string; name: string; email: string } };

// The checks 2 to 4 of the stage: the delegate, an open delegation, the mail itself.
async function checkMail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  email: EmailMeta,
  delegateId: string
): Promise<Checked> {
  const delegate = await lockDelegate(trx, ctx, delegateId);
  if (delegate === undefined) return { kind: "stop", result: { kind: "not_found" } };
  if (!delegate.active) return { kind: "stop", result: { kind: "delegate_inactive" } };
  const open = await findOpenDelegationOfEmail(trx, ctx, email.id);
  if (open !== undefined) return { kind: "stop", result: { kind: "exists", delegationId: open } };
  if (!(await delegable(trx, ctx, email))) return { kind: "stop", result: { kind: "not_delegable" } };
  return { kind: "go", delegate: { id: delegate.id, name: delegate.name, email: delegate.email } };
}

async function plan(
  trx: Transaction<DB>,
  ctx: TenantContext,
  found: {
    email: EmailMeta;
    delegate: { id: string; name: string; email: string };
    settings: Awaited<ReturnType<typeof getMailboxSettings>>;
  },
  input: { userId: string; via: DelegateMailVia },
  now: Date
): Promise<DelegateMailResult> {
  const { email, delegate, settings } = found;
  // No settings row: the mailbox has no drafts.
  if (settings === undefined) return { kind: "drafts_off" };
  const organization = await getOrganization(trx, ctx);
  if (organization === undefined) throw new HardError("organization not found");

  const triage = await latestTriageResult(trx, ctx, email.id);
  const language = languageSchema.safeParse((triage?.fields as { language?: unknown } | undefined)?.language);
  const draftLanguage = language.success && language.data === "pl" ? "pl" : "en";
  const summary = (await listSummaries(trx, ctx, [email.id])).get(email.id);
  const task = delegateTaskText(summary, email.subject, draftLanguage);

  // The planner of triage, with the delegate fixed by the user: the recipient is the address of the `delegates` row.
  const planned = planActions("delegation", null, {
    delegateId: delegate.id,
    delegateName: delegate.name,
    to: delegate.email,
    task,
    clarification: null,
    dueDate: null,
    language: draftLanguage,
    senderAddress: null,
  });
  const draftAction = planned.find((action) => action.type === "create_draft");
  const sendAction = planned.find((action) => action.type === "send");
  if (draftAction?.type !== "create_draft" || draftAction.draft.kind !== "delegation" || sendAction === undefined) {
    throw new HardError("the planner made no delegation pair");
  }
  const draft = draftAction.draft;
  // The policy of triage decides: a draft is `ready` and a send waits for approval only in `assist` mode with the switch
  // `create_draft` on. Any other answer means drafts are off (shadow mode, or the switch off).
  const statusOf = (action: PlannedAction) =>
    actionStatusFor(
      decidePolicy(action, {
        mode: settings.mode === "assist" ? "assist" : "shadow",
        toolSwitches: parseToolSwitches(settings.tool_switches),
        category: "delegation",
        categoryAuto: false,
        vip: false,
        movesSupported: false,
      })
    );
  const draftStatus = statusOf(draftAction);
  const sendStatus = statusOf(sendAction);
  if (draftStatus !== "ready" || sendStatus !== "awaiting_approval") return { kind: "drafts_off" };

  // The attempt number: a rejected or finished delegation of this mail leaves its keys, so the next pick gets new ones.
  const k = 1 + (await countDelegationsOfEmail(trx, ctx, email.id, "button"));
  const items: PlannedActionInput[] = [
    {
      type: "create_draft",
      payload: draft,
      status: draftStatus,
      idempotencyKey: `${email.id}:create_draft:delegation:button:${k}`,
    },
    {
      type: "send",
      payload: sendPayloadFor(draft),
      status: sendStatus,
      idempotencyKey: `${email.id}:send:delegation:button:${k}`,
      dependsOn: "create_draft",
    },
  ];
  const created = await createPlanned(trx, ctx, email.id, items);
  const createdDraft = created.find((action) => action.type === "create_draft");
  const createdSend = created.find((action) => action.type === "send");
  if (createdDraft === undefined || createdSend === undefined) {
    // The mail row is locked and no delegation of the mail is open, so the keys of this attempt cannot exist: an invariant break.
    throw new HardError("the delegate keys exist after the mail lock");
  }

  const delegationId = await createDelegation(trx, ctx, {
    mailboxId: email.mailbox_id,
    emailId: email.id,
    delegateId: delegate.id,
    draftActionId: createdDraft.id,
    sendActionId: createdSend.id,
    task,
    dueDate: null,
    timezone: organization.timezone,
    now,
    source: "button",
    via: input.via,
    actor: input.userId,
  });
  await setDelegationId(trx, ctx, [createdDraft.id, createdSend.id], delegationId);
  await auditPlanned(trx, ctx, email.id, input.userId, now, created);
  return { kind: "planned", sendId: createdSend.id, delegationId };
}

async function auditPlanned(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  userId: string,
  at: Date,
  created: readonly CreatedAction[]
): Promise<void> {
  for (const action of created) {
    await recordAudit(trx, ctx, {
      emailId,
      actionId: action.id,
      actor: userId,
      event: auditEvents.actionPlanned,
      data: { action_type: action.type, status: action.status },
      at,
    });
  }
}
