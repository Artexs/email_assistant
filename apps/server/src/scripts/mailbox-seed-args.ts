import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CliDescription, type EvalCase, evalCaseSchema, splitAddress, UsageError } from "@ea/core";
import { z } from "zod";

import { isOwnerAddress, SYNTHETIC_MESSAGE_ID_DOMAIN, type SeedMessage } from "../modules/mail";

import { parseFlags } from "./lib/parse-flags";

const casesDir = resolve(import.meta.dir, "../../../../evals/cases");
export const evalSets = ["synthetic", "injection", "delegation", "all"] as const;
export type EvalSet = (typeof evalSets)[number];

export const cliDescriptions = [
  {
    name: "mailbox:seed",
    summary: "Appends synthetic mail to a test mailbox by IMAP.",
    risk: "dev",
    needs: ["db", "greenmail"],
    usage: [
      "bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> [--count 1] [--folder <path>] [--from-owner <address> [--number-from 1]]",
      "bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> --eval-cases synthetic|injection|delegation|all [--per-category n] [--folder <path>] [--from-owner <address> [--number-from 1]]",
      "  It refuses every mailbox that is not in TEST_MAILBOX_ADDRESS (one address, or a comma-separated list).",
      "  --folder: INBOX (default) or a sync folder path (Oferty, Społeczności, Rachunki, Wiadomości-śmieci); the folder must exist.",
      "  --from-owner: each From becomes <local>+ea-smoke-<nn>@<domain> of this address (nn = 01, 02, … from --number-from); To is the mailbox.",
      "    A mailbox with a real provider (Microsoft, Google) needs it: its mail never gets an outside From address.",
    ].join("\n"),
    exits: {
      1: "the mailbox is not the test mailbox, a real provider has no --from-owner, or a failure",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface SeedOptions {
  orgId: string;
  mailboxId: string;
  count: number;
  evalSet: EvalSet | undefined;
  perCategory: number | undefined;
  folder: string | undefined;
  /** Absent without `--from-owner`. */
  ownerFrom: { address: string; numberFrom: number } | undefined;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxSeedArgs(argv: string[]): SeedOptions {
  const { values } = parseFlags({
    args: argv,
    options: {
      "org-id": { type: "string" },
      "mailbox-id": { type: "string" },
      count: { type: "string", default: "1" },
      "eval-cases": { type: "string" },
      "per-category": { type: "string" },
      folder: { type: "string" },
      "from-owner": { type: "string" },
      "number-from": { type: "string" },
    },
  });
  const ids = z.object({ orgId: z.uuid(), mailboxId: z.uuid() }).safeParse({
    orgId: values["org-id"],
    mailboxId: values["mailbox-id"],
  });
  if (!ids.success) throw new UsageError("--org-id and --mailbox-id are required and must be uuids");
  const count = z.coerce.number().int().min(1).max(1000).safeParse(values.count);
  if (!count.success) throw new UsageError("--count must be an integer from 1 to 1000");
  const evalSet = z.enum(evalSets).optional().safeParse(values["eval-cases"]);
  if (!evalSet.success) throw new UsageError(`--eval-cases must be one of ${evalSets.join(", ")}`);
  const perCategory = z.coerce.number().int().min(1).optional().safeParse(values["per-category"]);
  if (!perCategory.success) throw new UsageError("--per-category must be an integer of 1 or more");
  if (evalSet.data === undefined && perCategory.data !== undefined) {
    throw new UsageError("--per-category needs --eval-cases");
  }
  const folder = values.folder;
  if (folder !== undefined && folder.length === 0) throw new UsageError("--folder must not be empty");
  const owner = values["from-owner"];
  const numberText = values["number-from"];
  // `--number-from` means nothing without `--from-owner`; an owner address without `local@domain` is a usage error.
  if (owner === undefined && numberText !== undefined) throw new UsageError("--number-from needs --from-owner");
  let ownerFrom: SeedOptions["ownerFrom"];
  if (owner !== undefined) {
    if (!isOwnerAddress(owner)) throw new UsageError("--from-owner must be an address of the form local@domain");
    const numberFrom = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(9999))
      .safeParse(numberText ?? "1");
    if (!numberFrom.success) throw new UsageError("--number-from must be an integer from 1 to 9999");
    ownerFrom = { address: owner, numberFrom: numberFrom.data };
  }
  return { ...ids.data, count: count.data, evalSet: evalSet.data, perCategory: perCategory.data, folder, ownerFrom };
}

export function loadCases(file: string): EvalCase[] {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

/** `to` stays empty: `seedMailbox` sets the mailbox address. */
export function toSeedMessage(evalCase: EvalCase): SeedMessage {
  const { name, address } = splitAddress(evalCase.from);
  return {
    messageId: `<eval-${evalCase.id}-${randomUUID()}@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`,
    from: name === null ? address : `${name} <${address}>`,
    to: [],
    subject: evalCase.subject,
    date: new Date(),
    text: evalCase.body,
    headers: { "X-EA-Seed": "1" },
  };
}
