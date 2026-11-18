import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { type EvalCase, evalCaseSchema, splitAddress } from "@ea/core";
import { z } from "zod";

import { isOwnerAddress, SYNTHETIC_MESSAGE_ID_DOMAIN, type SeedMessage } from "../modules/mail";

const casesDir = resolve(import.meta.dir, "../../../../evals/cases");
export const evalSets = ["synthetic", "injection", "delegation", "all"] as const;
export type EvalSet = (typeof evalSets)[number];

export const usage = [
  "usage: bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> [--count 1] [--folder <path>] [--from-owner <address> [--number-from 1]]",
  "       bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> --eval-cases synthetic|injection|delegation|all [--per-category n] [--folder <path>] [--from-owner <address> [--number-from 1]]",
  "  It refuses every mailbox that is not in TEST_MAILBOX_ADDRESS (one address, or a comma-separated list).",
  "  --folder: INBOX (default) or a sync folder path (Oferty, Społeczności, Rachunki, Wiadomości-śmieci); the folder must exist.",
  "  --from-owner: each From becomes <local>+ea-smoke-<nn>@<domain> of this address (nn = 01, 02, … from --number-from); To is the mailbox.",
  "    A mailbox with a real provider (Microsoft, Google) needs it: its mail never gets an outside From address.",
].join("\n");

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

export function readSeedOptions(argv: string[]): SeedOptions | undefined {
  try {
    const { values } = parseArgs({
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
    const owner = values["from-owner"];
    const numberText = values["number-from"];
    // `--number-from` means nothing without `--from-owner`; an owner address without `local@domain` is a usage error.
    if (owner === undefined && numberText !== undefined) return undefined;
    let ownerFrom: SeedOptions["ownerFrom"];
    if (owner !== undefined) {
      if (!isOwnerAddress(owner)) return undefined;
      const numberFrom = z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(9999))
        .safeParse(numberText ?? "1");
      if (!numberFrom.success) return undefined;
      ownerFrom = { address: owner, numberFrom: numberFrom.data };
    }
    return {
      orgId,
      mailboxId,
      count: count.data,
      evalSet: evalSet.data,
      perCategory: perCategory.data,
      folder,
      ownerFrom,
    };
  } catch {
    return undefined;
  }
}

export function loadCases(file: string): EvalCase[] {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

/** `to` is a placeholder: `seedMailbox` sets the mailbox address when `--from-owner` is given. */
export function toSeedMessage(evalCase: EvalCase, to: string): SeedMessage {
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
