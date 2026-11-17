// "Turn on recommended" (ADR 0028 point 4): one tap turns on every moving category that the evidence recommends.
import { effectiveAutoFor, movingCategories, type MailboxMode, type MovingCategory } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import {
  getSettingsView,
  lockMailboxSettings,
  setCategoryAuto,
  setMode,
  type SettingsDeps,
  type SettingsView,
} from "../config";

import { judgeCategory, readEvidenceInputs } from "./gate";
import type { TrustViewDeps } from "./view";

export type RecommendedResult =
  | { kind: "turned_on"; turnedOn: MovingCategory[]; mode: MailboxMode }
  // No moving category is recommended and off: the mode and the policy stay as they are.
  | { kind: "nothing_recommended" }
  | { kind: "not_found" };

function inTransaction<T>(db: SettingsDeps["db"], run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

/**
 * One transaction under the `FOR UPDATE` lock of the settings row (the share lock would deadlock with the setters that take
 * `FOR UPDATE`; see the tripwire). The evidence is read after the lock, so a second tap at once reads the first one's commit and
 * turns nothing on. For each moving category that is recommended and not on under the running key: `auto` on, grant `recommended`,
 * threshold from the gate file. A `shadow` mailbox goes to `assist` first with the default switches, as `setMode` does. A tripped
 * category is never recommended, so this path clears no trip. One audit row per change, `via: "web"`.
 */
export async function turnOnRecommended(
  deps: TrustViewDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { actor: string }
): Promise<RecommendedResult> {
  const { settings } = deps;
  return inTransaction(settings.db, async (trx): Promise<RecommendedResult> => {
    const locked = await lockMailboxSettings(trx, ctx, mailboxId);
    if (!locked) return { kind: "not_found" };
    const inTrx: SettingsDeps = { ...settings, db: trx };
    const before: SettingsView = await getSettingsView(inTrx, ctx, mailboxId);
    const inputs = await readEvidenceInputs(trx, ctx, mailboxId, {
      gate: settings.gate,
      testMail: deps.testMail,
      now: settings.now(),
    });
    const due = movingCategories.filter(
      (category) =>
        judgeCategory(inputs, category).recommended &&
        !effectiveAutoFor(before.categoryPolicy, category, settings.gate.runningKey)
    );
    if (due.length === 0) return { kind: "nothing_recommended" };

    if (before.mode === "shadow") {
      await setMode(inTrx, ctx, mailboxId, {
        mode: "assist",
        keepSwitches: false,
        actor: input.actor,
        auditData: { via: "web" },
      });
    }
    for (const category of due) {
      const gate = inputs.gates[category];
      const threshold = inputs.globals[category].threshold ?? undefined;
      await setCategoryAuto(inTrx, ctx, mailboxId, {
        category,
        auto: true,
        ...(threshold === undefined ? {} : { threshold }),
        gate: { decision: "evidence", precision: gate.precision, kept: gate.kept, forced: false },
        grantBy: "recommended",
        auditData: { via: "web" },
        actor: input.actor,
      });
    }
    return { kind: "turned_on", turnedOn: due, mode: "assist" };
  });
}
