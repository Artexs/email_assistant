import { trustEvidenceOf } from "../composition";
import { createTelegramRuntime } from "../modules/channels";
import { testMailRule } from "../platform/config";

import type { StartContext } from "./context";
import type { JobsStart } from "./jobs";
import type { TriageStart } from "./triage";

// The Telegram runtime, when `TELEGRAM_BOT_TOKEN` is set. It sets `ctx.late.telegram`: the operator send and the shutdown read it later.
export function startTelegram(ctx: StartContext, triage: TriageStart, { scopeOfActions }: JobsStart): void {
  const { config, db, log, scheduler, runs, startedAt, late } = ctx;
  const { gate, hooks, uidplus, scopeOfSends, classifierRow, degraded } = triage;
  if (config.TELEGRAM_BOT_TOKEN === undefined) {
    log.info("telegram_off");
  } else {
    if (config.TELEGRAM_API_ROOT !== undefined) {
      log.warn("telegram_api_root_set");
    }
    const runtime = createTelegramRuntime({
      db,
      token: config.TELEGRAM_BOT_TOKEN,
      apiRoot: config.TELEGRAM_API_ROOT,
      now: () => new Date(),
      startedAt,
      llmDailyCap: config.LLM_DAILY_CAP,
      triageScope: config.TRIAGE_LLM_SCOPE,
      actionsScope: scopeOfActions,
      llm: { provider: classifierRow.provider, classifierModel: classifierRow.model },
      hooks,
      uidplus,
      sendScope: scopeOfSends,
      testMail: testMailRule(config),
      ...(degraded === undefined ? {} : { degraded }),
      trustEvidence: trustEvidenceOf(db, () => new Date(), gate, testMailRule(config)),
      operatorContact: config.OPERATOR_CONTACT ?? null,
      syncEveryMin: Number(config.MAIL_SYNC_EVERY_MIN),
      ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
    });
    late.telegram = runtime;
    // prettier-ignore
    scheduler.add("channels.notifier", "*/15 * * * * *", runs.track("channels.notifier", () => runtime.notify()));
    // prettier-ignore
    scheduler.add("channels.digest", "5 * * * * *", runs.track("channels.digest", () => runtime.scheduleDigests()));
    runtime.startPolling();
  }
}
