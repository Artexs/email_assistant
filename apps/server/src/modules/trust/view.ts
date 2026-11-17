// The trust view of one mailbox (F110 stage 11): the one reader behind the autonomy card, the report page and M8. It
// reads the settings, the three evidence sources, the real labels, the newest check and the examples of the report. Counts, codes
// and dates, plus the examples (sender name and subject: the panel is behind login and the view never goes to Telegram).
import {
  barCategories,
  effectiveAutoFor,
  movingCategories,
  TRUST_EXAMPLES_PER_CATEGORY,
  type BarCategory,
  type MovingCategory,
  type TrustCategory,
  type TrustCheck,
  type TrustExample,
  type TrustView,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getSettingsView, SettingsNotFoundError, type SettingsDeps } from "../config";
import { listMailExamples, type TestMailRule } from "../mail";
import { isFeatureOn } from "../tenancy";

import { judgeCategory, readEvidenceInputs } from "./gate";
import { countItems, listMovedExampleIds } from "./history-items";
import { latestHistoryCheck, newestDoneCheck, type HistoryCheckRow } from "./repo";

export interface TrustViewDeps {
  /** The settings setters' deps: `db`, the clock and the global evidence of the running classifier. */
  settings: SettingsDeps;
  testMail: TestMailRule;
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export async function checkViewOf(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  row: HistoryCheckRow
): Promise<TrustCheck> {
  return {
    status: row.status,
    reason: row.reason,
    noResultReason: row.noResultReason,
    startedAt: row.createdAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    checked: await countItems(db, ctx, row.id),
    capped: row.capped,
  };
}

// Up to 3 mails per moving category, newest first: the mails the user dealt with that the category would have moved. They come from the
// newest `done` check, as the history result does. A mail gone since (a DSR erase) has no item. The texts are null after retention.
async function examplesOf(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  checkId: string | null
): Promise<Record<MovingCategory, TrustExample[]>> {
  const examples = Object.fromEntries(movingCategories.map((category) => [category, []])) as unknown as Record<
    MovingCategory,
    TrustExample[]
  >;
  if (checkId === null) return examples;
  for (const category of movingCategories) {
    const ids = await listMovedExampleIds(db, ctx, checkId, category);
    const facts = await listMailExamples(db, ctx, ids);
    examples[category] = [...facts]
      .sort(([idA, a], [idB, b]) => b.receivedAt.getTime() - a.receivedAt.getTime() || (idA < idB ? 1 : -1))
      .slice(0, TRUST_EXAMPLES_PER_CATEGORY)
      .map(([emailId, fact]) => ({
        emailId,
        receivedAt: fact.receivedAt.toISOString(),
        fromName: fact.fromName,
        subject: fact.subject,
      }));
  }
  return examples;
}

/**
 * The view of one mailbox of the organization. `null`: no such mailbox in the organization (a foreign id looks like an unknown one).
 * It does not read the flag to refuse: `flag` says whether `trust_ladder` is on and the caller decides. `auto` is what triage reads
 * now (`effectiveAutoFor`): a category that is on under another model setup shows off, as it acts.
 */
export async function trustViewFor(
  deps: TrustViewDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<TrustView | null> {
  const { settings } = deps;
  const { db } = settings;
  const now = settings.now();
  let view;
  try {
    view = await getSettingsView(settings, ctx, mailboxId);
  } catch (error) {
    if (error instanceof SettingsNotFoundError) return null;
    throw error;
  }
  const inputs = await readEvidenceInputs(db, ctx, mailboxId, { gate: settings.gate, testMail: deps.testMail, now });
  const latest = await latestHistoryCheck(db, ctx, mailboxId);
  const done = await newestDoneCheck(db, ctx, mailboxId);

  const categories = {} as Record<BarCategory, TrustCategory>;
  for (const category of barCategories) {
    const gate = inputs.gates[category];
    const auto = effectiveAutoFor(view.categoryPolicy, category, settings.gate.runningKey);
    const trip = inputs.trips.get(category);
    const moving = (movingCategories as readonly string[]).includes(category);
    categories[category] = {
      auto,
      grantBy: auto ? (view.categoryPolicy[category]?.grant?.by ?? null) : null,
      global: inputs.globals[category],
      history: moving ? (inputs.history[category as MovingCategory] ?? null) : null,
      trip: { tripped: trip?.tripped ?? false, reason: trip?.reason ?? null, at: iso(trip?.at ?? null) },
      realLabels: { kept: gate.kept, precision: gate.precision, decision: gate.decision },
      evidence: judgeCategory(inputs, category),
    };
  }

  return {
    mailboxId,
    flag: await isFeatureOn(db, ctx, "trust_ladder"),
    key: settings.gate.runningKey,
    mode: view.mode,
    check: latest === null ? null : await checkViewOf(db, ctx, latest),
    categories,
    examples: await examplesOf(db, ctx, done?.id ?? null),
  };
}
