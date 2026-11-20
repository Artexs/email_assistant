import {
  checkProfileInput,
  profileFallbacks,
  profileFields,
  type ProfileErrorCode,
  type ProfileField,
  type ProfileInput,
  type ProfileView,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { getMailbox, mailboxProfileOf, upsertMailboxProfile, type MailboxProfile } from "../mail";
import { getOrganization, getOrgOwner } from "../tenancy";

type DbOrTrx = Db | Transaction<DB>;

// Who writes. `web` carries the signed-in owner; `cli` is the operator (`updated_by` stays null).
export type ProfileVia = { via: "web"; userId: string } | { via: "cli" };

const AUDIT_NAME: Record<ProfileField, string> = {
  displayName: "display_name",
  signature: "signature",
  writingStyle: "writing_style",
};

// The stored values and the texts that stand in for a null, so that the card shows what is used. Undefined: the mailbox is
// not of the organization (a foreign id answers like an unknown one).
export async function getProfileView(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<ProfileView | undefined> {
  const [mailbox, organization, owner, profile] = await Promise.all([
    getMailbox(db, ctx, mailboxId),
    getOrganization(db, ctx),
    getOrgOwner(db, ctx),
    mailboxProfileOf(db, ctx, mailboxId),
  ]);
  if (mailbox === undefined || organization === undefined) return undefined;
  const fallbacks = profileFallbacks({
    ownerName: owner?.displayName ?? null,
    address: mailbox.address,
  });
  return {
    displayName: profile?.displayName ?? null,
    signature: profile?.signature ?? null,
    writingStyle: profile?.writingStyle ?? null,
    fallbackName: fallbacks.name,
    fallbackSignature: fallbacks.signature,
  };
}

export type ProfileUpdate =
  | { kind: "updated"; view: ProfileView; changed: ProfileField[] }
  | { kind: "invalid"; field: ProfileField; code: ProfileErrorCode }
  | { kind: "not_found" };

function storedOf(profile: MailboxProfile | null, field: ProfileField): string | null {
  return profile === null ? null : profile[field];
}

/**
 * The one write of the profile; the route and the CLI both call it (ADR 0023). The text is cleaned and checked by
 * `checkProfileInput`: a name that is not safe for a header, or a text that is too long, is `invalid` and nothing is stored. An empty
 * string stores null (the fallback applies). A field that does not change is not written. One audit row `mailbox.profile_changed`
 * names the changed fields and never holds a text.
 */
export async function updateMailboxProfile(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  input: ProfileInput,
  by: ProfileVia
): Promise<ProfileUpdate> {
  const checked = checkProfileInput(input);
  if (!checked.ok) return { kind: "invalid", field: checked.field, code: checked.code };
  const write = async (trx: Transaction<DB>): Promise<ProfileUpdate> => {
    if ((await getMailbox(trx, ctx, mailboxId)) === undefined) return { kind: "not_found" };
    const before = await mailboxProfileOf(trx, ctx, mailboxId);
    const changed = profileFields.filter(
      (field) => checked.fields[field] !== undefined && checked.fields[field] !== storedOf(before, field)
    );
    if (changed.length > 0) {
      await upsertMailboxProfile(
        trx,
        ctx,
        mailboxId,
        Object.fromEntries(changed.map((field) => [field, checked.fields[field] ?? null])),
        by.via === "web" ? by.userId : null
      );
      await recordAudit(trx, ctx, {
        actor: by.via === "web" ? by.userId : "cli",
        event: auditEvents.mailboxProfileChanged,
        data: { mailbox_id: mailboxId, fields: changed.map((field) => AUDIT_NAME[field]).join(","), via: by.via },
      });
    }
    const view = await getProfileView(trx, ctx, mailboxId);
    if (view === undefined) return { kind: "not_found" };
    return { kind: "updated", view, changed };
  };
  return db.isTransaction ? write(db as Transaction<DB>) : db.transaction().execute(write);
}
