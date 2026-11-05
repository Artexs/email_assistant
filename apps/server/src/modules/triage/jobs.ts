import { mailboxModes, parseCategoryPolicy, parseToolSwitches } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db } from "../../platform/db";
import type { LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { getMailboxSettings, listSenderRules } from "../config";
import { claimEmails, getMailbox, listSyncTargets } from "../mail";

import type { LlmPause } from "./pause";
import { finishTriageError, HARD_ERROR_TRIES, triageOne, type TriageMailbox } from "./service";

const log = createLog("triage");

const STALE_AFTER_MS = 5 * 60_000;

const modeSchema = z.enum(mailboxModes);

// `synthetic`: only the seeded test mail of every mailbox. `all`: all mail, but only of one mailbox.
export type TriageScope = { kind: "synthetic" } | { kind: "all"; mailboxAddress: string };

export interface TriageJobDeps {
  db: Db | Transaction<DB>;
  llm: LlmClient;
  pause: LlmPause;
  scope: TriageScope;
  batchSize: number;
  now(): Date;
  // Only for tests of an error outside the LLM call.
  triageOne?: typeof triageOne;
}

// The log lines carry the mailbox id only: never the address.
export function createTriageJob(deps: TriageJobDeps): { run(): Promise<void> } {
  const warnedNoSettings = new Set<string>();
  const triage = deps.triageOne ?? triageOne;
  const scopeAddress = deps.scope.kind === "all" ? deps.scope.mailboxAddress.trim().toLowerCase() : null;

  return {
    async run() {
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        const row = await getMailbox(deps.db, ctx, mailboxId);
        if (row === undefined) continue;
        if (scopeAddress !== null && row.address.toLowerCase() !== scopeAddress) continue;

        const settings = await getMailboxSettings(deps.db, ctx, mailboxId);
        if (settings === undefined) {
          if (!warnedNoSettings.has(mailboxId)) {
            warnedNoSettings.add(mailboxId);
            log.warn(`triage ${mailboxId}: no mailbox_settings row, mailbox skipped`);
          }
          continue;
        }

        const capabilities: { move?: boolean; uidplus?: boolean } = row.capabilities;
        const mailbox: TriageMailbox = {
          id: mailboxId,
          mode: modeSchema.parse(settings.mode),
          toolSwitches: parseToolSwitches(settings.tool_switches),
          policy: parseCategoryPolicy(settings.category_policy),
          rules: await listSenderRules(deps.db, ctx, mailboxId),
          movesSupported: capabilities.move === true || capabilities.uidplus === true,
        };

        const now = deps.now();
        const claimed = await claimEmails(deps.db, ctx, mailboxId, {
          now,
          limit: deps.batchSize,
          staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
          syntheticOnly: deps.scope.kind === "synthetic",
        });
        for (const email of claimed) {
          // A stale take-back counts an attempt: a mail that reached the limit this way gets no more LLM call.
          if (email.attempts >= HARD_ERROR_TRIES) {
            await finishTriageError(deps, ctx, mailbox, email);
            continue;
          }
          await triage(deps, ctx, mailbox, email);
        }
      }
    },
  };
}
