import { openImapProvider } from "../../../apps/server/src/modules/mail";
import { loadConfig } from "../../../apps/server/src/platform/config";
import { createDb } from "../../../apps/server/src/platform/db";

const usage = "usage: DATABASE_URL=<url> GM_USER=<GreenMail user> bun tools/fake-telegram/scripts/check-undo.ts";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const user = process.env.GM_USER;
  if (!user || !process.env.DATABASE_URL) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const db = createDb(loadConfig().DATABASE_URL);
  try {
    const mailbox = await db.selectFrom("mailboxes").select("id").where("address", "=", user).executeTakeFirst();
    if (!mailbox) {
      out(`no mailbox with address ${user}`);
      return 1;
    }
    const actions = await db
      .selectFrom("actions")
      .innerJoin("emails", "emails.id", "actions.email_id")
      .select(["actions.type", "actions.status", "actions.status_reason", "actions.reverses_action_id"])
      .where("emails.mailbox_id", "=", mailbox.id)
      .orderBy("actions.created_at")
      .execute();
    for (const a of actions) {
      out(
        `action ${a.type} ${a.status} reason=${a.status_reason ?? "-"} reverse=${a.reverses_action_id ? "yes" : "no"}`
      );
    }
    const feedback = await db
      .selectFrom("triage_feedback")
      .innerJoin("emails", "emails.id", "triage_feedback.email_id")
      .select(["triage_feedback.source"])
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("emails.mailbox_id", "=", mailbox.id)
      .groupBy("triage_feedback.source")
      .execute();
    for (const f of feedback) out(`triage_feedback ${f.source}: ${f.n}`);

    const emails = await db.selectFrom("emails").select("uid").where("mailbox_id", "=", mailbox.id).execute();
    const provider = await openImapProvider({
      host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
      port: Number(process.env.TEST_IMAP_PORT ?? 3143),
      user,
      password: "greenmail-test",
    });
    let flagged = false;
    try {
      for (const { uid } of emails) {
        const meta = await provider.fetchMetaIn("INBOX", Number(uid));
        const flags = meta?.flags ?? [];
        out(`uid ${uid} flags: [${flags.join(" ")}]`);
        if (flags.includes("\\Flagged")) flagged = true;
      }
    } finally {
      await provider.close();
    }

    const undone = actions.some((a) => !a.reverses_action_id && a.status === "undone");
    const reversed = actions.some((a) => a.reverses_action_id && a.status === "applied");
    const undoFeedback = feedback.some((f) => f.source === "undo");
    const ok = undone && reversed && undoFeedback && !flagged;
    out(ok ? "OK: undo done" : "FAIL: undo not complete");
    return ok ? 0 : 1;
  } finally {
    await db.destroy();
  }
}

process.exit(await main());
