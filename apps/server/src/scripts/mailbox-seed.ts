import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { type EvalCase, evalCaseSchema, selectCases, splitAddress } from "@ea/core";
import { z } from "zod";

import { SYNTHETIC_MESSAGE_ID_DOMAIN, seedMailbox, type SeedMessage } from "../modules/mail";
import { loadConfig } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("mailbox-seed");

const casesDir = resolve(import.meta.dir, "../../../../evals/cases");
const evalSets = ["synthetic", "injection", "delegation", "all"] as const;

const usage = [
  "usage: bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> [--count 1] [--folder <path>]",
  "       bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> --eval-cases synthetic|injection|delegation|all [--per-category n] [--folder <path>]",
  "  It refuses every mailbox except the one in TEST_MAILBOX_ADDRESS.",
  "  --folder: INBOX (default) or a sync folder path (Oferty, Społeczności, Rachunki, Wiadomości-śmieci); the folder must exist.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        count: { type: "string", default: "1" },
        "eval-cases": { type: "string" },
        "per-category": { type: "string" },
        folder: { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const count = z.coerce.number().int().min(1).max(1000).safeParse(values.count);
    if (!count.success) return undefined;
    const evalSet = z.enum(evalSets).optional().safeParse(values["eval-cases"]);
    if (!evalSet.success) return undefined;
    const perCategory = z.coerce.number().int().min(1).optional().safeParse(values["per-category"]);
    if (!perCategory.success) return undefined;
    if (evalSet.data === undefined && perCategory.data !== undefined) return undefined;
    const folder = values.folder;
    if (folder !== undefined && folder.length === 0) return undefined;
    return { orgId, mailboxId, count: count.data, evalSet: evalSet.data, perCategory: perCategory.data, folder };
  } catch {
    return undefined;
  }
}

function loadCases(file: string): EvalCase[] {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

function toSeedMessage(evalCase: EvalCase, to: string): SeedMessage {
  const { name, address } = splitAddress(evalCase.from);
  return {
    messageId: `<eval-${evalCase.id}-${randomUUID()}@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`,
    from: name === null ? address : `${name} <${address}>`,
    to: [to],
    subject: evalCase.subject,
    date: new Date(),
    text: evalCase.body,
    headers: { "X-EA-Seed": "1" },
  };
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    // The message list needs the mailbox address; seedMailbox checks the guard before any connection.
    const testAddress = config.TEST_MAILBOX_ADDRESS;
    let messages: SeedMessage[] | undefined;
    if (options.evalSet !== undefined) {
      const files = options.evalSet === "all" ? ["synthetic", "injection", "delegation"] : [options.evalSet];
      const cases = selectCases(
        files.flatMap((file) => loadCases(`${file}.json`)),
        { perCategory: options.perCategory }
      );
      messages = cases.map((evalCase) => toSeedMessage(evalCase, testAddress ?? ""));
    }
    const appended = await seedMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, {
      count: options.count,
      testAddress,
      messages,
      folder: options.folder,
    });
    log.info(`appended ${appended}`);
    return 0;
  } catch (error) {
    log.error("failed:", error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
