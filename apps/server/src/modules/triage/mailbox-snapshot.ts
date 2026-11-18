// The `TriageMailbox` snapshot for a caller that is not the triage job (the history check classifies with the settings
// of the mailbox as triage would). The triage job builds its snapshot in `jobs.ts`, between a claim and its first mail; the
// type `TriageMailbox` makes a field that one of them leaves out a compile error.
import { type EvidenceKey, mailboxModes, parseCategoryPolicy, parseToolSwitches } from "@ea/core";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { getMailboxSettings, listSenderRules, parseUrgencyProfile } from "../config";
import { listDelegates } from "../delegation";
import { getJunkFolderPath, getMailbox } from "../mail";
import { getOrganization } from "../tenancy";

import type { TriageMailbox } from "./service";
import { loadSuspiciousContext } from "./suspicious-context";

const modeSchema = z.enum(mailboxModes);

export type MailboxSnapshot =
  | { kind: "ok"; mailbox: TriageMailbox }
  | { kind: "missing"; what: "mailbox" | "settings" | "organization" };

/** `senders`: the From addresses of the mail that the caller classifies in this run (the known-sender read runs once for them). */
export async function loadTriageMailbox(
  db: Db,
  ctx: TenantContext,
  input: {
    mailboxId: string;
    runningKey: EvidenceKey;
    trustedAuthservIds?: readonly string[];
    senders: readonly (string | null)[];
    now: Date;
  }
): Promise<MailboxSnapshot> {
  const row = await getMailbox(db, ctx, input.mailboxId);
  if (row === undefined) return { kind: "missing", what: "mailbox" };
  const settings = await getMailboxSettings(db, ctx, input.mailboxId);
  if (settings === undefined) return { kind: "missing", what: "settings" };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) return { kind: "missing", what: "organization" };
  const delegates = (await listDelegates(db, ctx, { activeOnly: true })).map((delegate) => ({
    id: delegate.id,
    name: delegate.name,
    email: delegate.email,
    tags: delegate.competence_tags,
  }));
  const capabilities: { move?: boolean; uidplus?: boolean } = row.capabilities;
  const rules = await listSenderRules(db, ctx, input.mailboxId);
  const suspicious = await loadSuspiciousContext(db, ctx, {
    mailbox: { id: input.mailboxId, rules, delegates },
    imapHost: row.imap_host,
    senders: input.senders,
    trustedAuthservIds: input.trustedAuthservIds ?? [],
    now: input.now,
  });
  return {
    kind: "ok",
    mailbox: {
      id: input.mailboxId,
      settingsVersion: settings.version,
      mode: modeSchema.parse(settings.mode),
      toolSwitches: parseToolSwitches(settings.tool_switches),
      policy: parseCategoryPolicy(settings.category_policy),
      runningKey: input.runningKey,
      rules,
      movesSupported: capabilities.move === true || capabilities.uidplus === true,
      delegates,
      timezone: organization.timezone,
      junkFolder: await getJunkFolderPath(db, ctx, input.mailboxId),
      resumedAt: organization.resumed_at,
      suspicious,
      urgencyProfile: parseUrgencyProfile(settings.urgency_profile),
    },
  };
}
