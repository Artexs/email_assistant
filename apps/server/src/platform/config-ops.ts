import { isLoopbackApiRoot, userLocales, type SloThresholds } from "@ea/core";
import { z } from "zod";

import { addressPattern, emptyAsUndefined, parseList } from "./config-shared";

// The env keys of the operator, the Telegram bot and the service levels. `config.ts` spreads them into the schema.
export const opsShape = {
  // Empty or missing = Telegram off. Secret: never print or log it.
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{20,}$/)
      .optional()
  ),
  // Dev only: a local fake Bot API (tools/fake-telegram). Empty = the real Telegram.
  TELEGRAM_API_ROOT: z.preprocess(
    emptyAsUndefined,
    z.string().refine(isLoopbackApiRoot, "must be http(s)://127.0.0.1, ::1 or localhost, with no path").optional()
  ),
  // Public contact address shown in the paused banner and the paused Telegram answer. Empty = none.
  OPERATOR_CONTACT: z.preprocess(emptyAsUndefined, z.string().regex(addressPattern).optional()),
  // The operator's own Telegram chat id for operator notices (ids only). Needs TELEGRAM_BOT_TOKEN. Empty = log lines only. Private: never log it.
  OPERATOR_TELEGRAM_CHAT_ID: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^-?\d{1,15}$/)
      .optional()
  ),
  // The language of the operator alert texts: `en` or `pl`. Empty = `en`.
  OPERATOR_LOCALE: z.preprocess(emptyAsUndefined, z.enum(userLocales).default("en")),
  // Service levels of the operator alerts. Empty = the default. Whole numbers, except SLO_DISK_FREE_GB (decimals).
  // Minutes since the last sync before a mailbox counts as late.
  SLO_SYNC_LAG_MIN: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(5).max(1440).default(15)),
  // Minutes (outside quiet hours) that an urgent mail may wait for its notice.
  SLO_URGENT_LATENCY_MIN: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(240).default(10)),
  // The window of the LLM error rate, the least calls in it, the rate that opens the alert and the rate that closes it.
  SLO_LLM_WINDOW_MIN: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(5).max(240).default(30)),
  SLO_LLM_MIN_CALLS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(1000).default(5)),
  SLO_LLM_FAIL_PCT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(100).default(20)),
  SLO_LLM_CLEAR_PCT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(0).max(99).default(10)),
  // Hours between two notices of one open alert.
  SLO_REPEAT_H: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(168).default(6)),
  // Disk check: the volume to read (the path inside the container), the free percent and the free gigabytes that open the alert.
  SLO_DISK_PATH: z.preprocess(emptyAsUndefined, z.string().startsWith("/", "must be an absolute path").default("/")),
  SLO_DISK_FREE_PCT: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(90).default(15)),
  SLO_DISK_FREE_GB: z.preprocess(emptyAsUndefined, z.coerce.number().min(0.5).max(100).default(2)),
  // Hours since the last good backup before the alert opens.
  SLO_BACKUP_MAX_AGE_H: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(720).default(26)),
  // The status file that deploy/backup.sh writes (mounted read-only). Empty = the backup check is off.
  BACKUP_STATUS_FILE: z.preprocess(emptyAsUndefined, z.string().startsWith("/", "must be an absolute path").optional()),
  // Comma list of user ids (users.id, UUID) who may use /api/operator/*. Empty = no operator. Never log the ids.
  OPERATOR_USER_IDS: z.preprocess(emptyAsUndefined, z.string().optional()),
};

type OpsConfig = z.infer<z.ZodObject<typeof opsShape>>;

// The operator chat check of `configSchema`.
export function checkOperatorChat(config: OpsConfig, ctx: z.RefinementCtx): void {
  if (config.OPERATOR_TELEGRAM_CHAT_ID !== undefined && config.TELEGRAM_BOT_TOKEN === undefined) {
    ctx.addIssue({ code: "custom", path: ["OPERATOR_TELEGRAM_CHAT_ID"], message: "needs TELEGRAM_BOT_TOKEN" });
  }
}

// The service level checks of `configSchema`.
export function checkSlo(config: OpsConfig, ctx: z.RefinementCtx): void {
  if (config.SLO_LLM_CLEAR_PCT >= config.SLO_LLM_FAIL_PCT) {
    const message = "SLO_LLM_CLEAR_PCT must be lower than SLO_LLM_FAIL_PCT";
    ctx.addIssue({ code: "custom", path: ["SLO_LLM_CLEAR_PCT"], message });
    ctx.addIssue({ code: "custom", path: ["SLO_LLM_FAIL_PCT"], message });
  }
}

// The operator user ids check of `configSchema`.
export function checkOperatorUserIds(config: OpsConfig, ctx: z.RefinementCtx): void {
  if (!parseList(config.OPERATOR_USER_IDS).every((id) => z.uuid().safeParse(id).success)) {
    ctx.addIssue({ code: "custom", path: ["OPERATOR_USER_IDS"], message: "each entry must be a user id (UUID)" });
  }
}

/** The thresholds of the service-level checks. */
export function sloThresholds(config: OpsConfig): SloThresholds {
  return {
    syncLagMin: config.SLO_SYNC_LAG_MIN,
    urgentLatencyMin: config.SLO_URGENT_LATENCY_MIN,
    llmWindowMin: config.SLO_LLM_WINDOW_MIN,
    llmMinCalls: config.SLO_LLM_MIN_CALLS,
    llmFailPct: config.SLO_LLM_FAIL_PCT,
    llmClearPct: config.SLO_LLM_CLEAR_PCT,
    repeatH: config.SLO_REPEAT_H,
    diskPath: config.SLO_DISK_PATH,
    diskFreePct: config.SLO_DISK_FREE_PCT,
    diskFreeGb: config.SLO_DISK_FREE_GB,
    backupMaxAgeH: config.SLO_BACKUP_MAX_AGE_H,
    backupStatusFile: config.BACKUP_STATUS_FILE ?? null,
  };
}

// The operator's chat id for operator notices; null = log lines only.
export function operatorChatId(config: OpsConfig): number | null {
  return config.OPERATOR_TELEGRAM_CHAT_ID === undefined ? null : Number(config.OPERATOR_TELEGRAM_CHAT_ID);
}

/** User ids of the operator (`OPERATOR_USER_IDS`), lower-cased and unique. `configSchema` refuses an entry that is not a UUID. */
export function operatorUserIds(config: OpsConfig): ReadonlySet<string> {
  return new Set(parseList(config.OPERATOR_USER_IDS).map((id) => id.toLowerCase()));
}
