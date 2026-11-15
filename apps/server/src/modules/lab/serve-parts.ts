import type { Db } from "../../platform/db";
import { getMailboxSettings, setMode, type SettingsDeps } from "../config";

import { runDelegateBotsTick } from "./bots";
import { labAddresses, type LabCorpus } from "./corpus";
import { runExecutiveTick } from "./executive";
import type { FakeTgClient } from "./fake-tg";
import { runInjectorTick } from "./injector";
import { createLabMailClient, type LabMailAdmin, type LabMailClient, type LabMailClientOptions } from "./mail-client";
import { runSpend, type RunSpend } from "./run-spend";
import { LAB_IMAP_PORT, LAB_MAIL_HOST, LAB_MAIL_PASSWORD, LAB_SMTP_PORT } from "./seed";
import { finishRun, runModeStep, type ServeParts } from "./serve";
import type { LabRun, LabState } from "./state";

// The wiring of the serve loop: the parts of a tick, built over one mail client, one fake Telegram client and one DB.

const ACTOR = "cli";

/**
 * The options of the one mail client of the serve process. Host, ports and password are the constants of `seed.ts`
 * (the host of every lab mailbox is loopback); the addresses are the scenario addresses of `labAddresses`, which
 * include the run mailboxes and the `other_address` aliases. The injector and the bots get this one client and this one set.
 */
export function labMailOptions(corpus: LabCorpus): LabMailClientOptions & { allowedAddresses: ReadonlySet<string> } {
  return {
    host: LAB_MAIL_HOST,
    imapPort: LAB_IMAP_PORT,
    smtpPort: LAB_SMTP_PORT,
    password: LAB_MAIL_PASSWORD,
    allowedAddresses: new Set(labAddresses(corpus)),
  };
}

export interface ServePartsDeps {
  db: Db;
  state: LabState;
  corpus: LabCorpus;
  /** One client for the injector and the bots: build it with `createLabMailClient(labMailOptions(corpus))`. */
  mail: LabMailClient;
  tg: FakeTgClient;
  settings: SettingsDeps;
  now: () => Date;
}

export const createServeMailClient = (corpus: LabCorpus): LabMailClient & LabMailAdmin =>
  createLabMailClient(labMailOptions(corpus));

function orgOf(state: LabState, run: LabRun): { orgId: string; mailboxId: string } {
  const org = state.readOrgs()[run.org];
  if (org === undefined) throw new Error(`lab serve: org ${run.org} is not seeded`);
  return org;
}

export function buildServeParts(deps: ServePartsDeps): {
  parts: ServeParts;
  spendOf: (runId: string) => Promise<RunSpend>;
} {
  const { db, state, corpus, mail, tg, now } = deps;
  const allowedAddresses = new Set(labAddresses(corpus));

  const spendOf = async (runId: string): Promise<RunSpend> => {
    const run = state.readRun(runId);
    return runSpend(db, orgOf(state, run).orgId, run);
  };

  const setAssist = async (runId: string): Promise<void> => {
    const { orgId, mailboxId } = orgOf(state, state.readRun(runId));
    const ctx = { orgId };
    // The mode change also sets the default switches, so a second call changes nothing only when the mode is set.
    if ((await getMailboxSettings(db, ctx, mailboxId))?.mode === "assist") return;
    await setMode(deps.settings, ctx, mailboxId, { mode: "assist", keepSwitches: false, actor: ACTOR });
  };

  const parts: ServeParts = {
    mode: (runId) => runModeStep({ state, now, setAssist }, runId),
    injector: (runId) =>
      runInjectorTick({ state, mail, corpus, now, spendUsd: async () => (await spendOf(runId)).usd }, runId),
    bots: (runId) => runDelegateBotsTick({ state, mail, corpus, now, allowedAddresses }, runId),
    executive: (runId) => runExecutiveTick({ state, tg, db, now, corpus }, runId),
    finish: async (runId, reason) => finishRun(state, runId, reason, (await spendOf(runId)).usd, now()),
  };
  return { parts, spendOf };
}
