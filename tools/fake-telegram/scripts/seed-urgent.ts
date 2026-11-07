import { randomUUID } from "node:crypto";

import { appendUrgentSeed, type E2eMailbox } from "../test/setup";

const usage = "usage: GM_USER=<GreenMail user> bun tools/fake-telegram/scripts/seed-urgent.ts";

async function main(): Promise<number> {
  const user = process.env.GM_USER;
  if (!user) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const box = {
    imap: {
      host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
      port: Number(process.env.TEST_IMAP_PORT ?? 3143),
      user,
      password: "greenmail-test",
    },
  } as E2eMailbox;
  const subject = `Live urgent ${randomUUID()}`;
  // The @ea-seed.test Message-ID makes the mail synthetic for TRIAGE_LLM_SCOPE=synthetic.
  const { messageId } = await appendUrgentSeed(box, { subject });
  process.stdout.write(`subject: ${subject}\nmessage-id: ${messageId}\n`);
  return 0;
}

process.exit(await main());
