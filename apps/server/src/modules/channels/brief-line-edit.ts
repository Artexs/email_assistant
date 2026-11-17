import { noticeViewSchemas, outButtonsSchema, parseCallback, type OutButton, type OutMessage } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { CallbackResult, LinkedChat } from "./port";
import { OUTBOX_REMOVED_TEXT } from "./repo";

// What a tap on a loop line of the brief edits: the line of the digest message that was tapped (F116 stage 19). The stored text of
// the digest is kept: the edit changes one line and its buttons, it never renders the digest again (docs/code-patterns.md). The edit is
// stored back in the outbox row (the cache of the sent message), so the next tap on another line starts from this one's result.
// The digest view holds the line number of each loop or delegation (`lineOf`). A digest that has no such number, was cleared, or
// whose line no longer starts as a brief line does: the buttons go and the text stays.
// `keyboard`: the stored text was blanked (`[removed]`): only the buttons of the chat message change, its text stays (review 19 N2).
export type BriefLineEdit =
  | { digest: false }
  | { digest: true; edit: OutMessage | undefined; keyboard?: OutButton[][] };

// What a handler puts into its `CallbackResult` for a line edit: the edit or the keyboard, else nothing.
export function lineEditResult(line: BriefLineEdit): Pick<CallbackResult, "edit" | "keyboard"> {
  if (!line.digest) return {};
  if (line.keyboard !== undefined) return { keyboard: line.keyboard };
  return line.edit === undefined ? {} : { edit: line.edit };
}

const LINE_STARTS = /^(⏳|🤝|⌛)/u;

// The id that a button of the keyboard names: a loop or a delegation.
function buttonId(button: OutButton): string | undefined {
  const callback = parseCallback(button.data);
  if (callback === null) return undefined;
  if ("loopId" in callback) return callback.loopId;
  if (callback.kind === "delegation_done") return callback.delegationId;
  return undefined;
}

export async function editBriefLine(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  link: LinkedChat,
  input: {
    messageId: number;
    // The loop or the delegation of the tapped line.
    id: string;
    // The mark in front of the line, or null: the line stays as it is.
    mark: string | null;
    // `all`: every button of the line goes. A list: only the buttons with this data go.
    drop: "all" | readonly string[];
  }
): Promise<BriefLineEdit> {
  const run = async (trx: Transaction<DB>): Promise<BriefLineEdit> => {
    const row = await trx
      .selectFrom("outbox")
      .select(["id", "text", "buttons", "view", "sent_at"])
      .where("org_id", "=", ctx.orgId)
      .where("user_id", "=", link.userId)
      .where("kind", "=", "digest")
      .where("status", "=", "sent")
      .where("external_message_id", "=", String(input.messageId))
      .forUpdate()
      .executeTakeFirst();
    // A message id belongs to one chat: a digest sent before the user linked another chat is not this message.
    if (row === undefined || row.sent_at === null || link.linkedAt > row.sent_at) return { digest: false };
    const buttons = outButtonsSchema.safeParse(row.buttons);
    if (row.text === null || !buttons.success) return { digest: true, edit: undefined };
    const keep = (button: OutButton): boolean =>
      input.drop === "all" ? buttonId(button) !== input.id : !input.drop.includes(button.data);
    const rows = buttons.data.map((line) => line.filter(keep)).filter((line) => line.length > 0);
    // A blanked message (retention, the Sent switch, an erase): the chat keeps its old text, so only the keyboard is edited. The stored
    // text stays the marker, and the stored buttons follow.
    if (row.text === OUTBOX_REMOVED_TEXT) {
      await trx
        .updateTable("outbox")
        .set({ buttons: JSON.stringify(outButtonsSchema.parse(rows)) })
        .where("org_id", "=", ctx.orgId)
        .where("id", "=", row.id)
        .execute();
      return { digest: true, edit: undefined, keyboard: rows };
    }
    const view = noticeViewSchemas.digest.safeParse(row.view);
    const at = view.success ? view.data.lineOf?.[input.id] : undefined;
    const lines = row.text.split("\n");
    const line = at === undefined ? undefined : lines[at];
    if (input.mark !== null && line !== undefined && LINE_STARTS.test(line))
      lines[at as number] = `${input.mark} ${line}`;
    const text = lines.join("\n");
    await trx
      .updateTable("outbox")
      .set({ text, buttons: JSON.stringify(outButtonsSchema.parse(rows)) })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", row.id)
      .execute();
    return { digest: true, edit: { text, buttons: rows } };
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
