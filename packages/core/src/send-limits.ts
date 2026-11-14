// Send limits (PD-044): a pure rule. No I/O and no Date.now(): the caller passes `now`.

export const sendLimitKinds = ["mailbox_hour", "mailbox_day", "recipient_day"] as const;
export type SendLimitKind = (typeof sendLimitKinds)[number];

export interface SendLimits {
  /** Sends per mailbox per rolling hour. */
  mailboxHour: number;
  /** Sends per mailbox per rolling 24 h. */
  mailboxDay: number;
  /** Sends per mailbox and recipient address per rolling 24 h. */
  recipientDay: number;
}

export const DEFAULT_SEND_LIMITS: SendLimits = { mailboxHour: 20, mailboxDay: 100, recipientDay: 5 };

export const SEND_LIMIT_WINDOW_MS: Record<SendLimitKind, number> = {
  mailbox_hour: 3_600_000,
  mailbox_day: 86_400_000,
  recipient_day: 86_400_000,
};

/** A send that counts: its start time and its recipients as stored in the payload. */
export interface RecentSend {
  startedAt: Date;
  to: readonly string[];
}

export type SendLimitResult = { kind: "ok" } | { kind: "held"; limit: SendLimitKind; until: Date };

const normalizeAddress = (address: string): string => address.trim().toLowerCase();

/**
 * The time at which a window with `cap` sends lets one more through, or null when it is not full.
 * A send counts while `startedAt > now - window` (strict). With k >= cap counted sends at ascending
 * times t[0..k-1], the window passes at t[k - cap] + window: then cap - 1 sends remain.
 */
function windowUntil(counted: readonly Date[], cap: number, windowMs: number): Date | null {
  if (counted.length < cap) return null;
  const times = counted.map((startedAt) => startedAt.getTime()).sort((a, b) => a - b);
  return new Date(times[times.length - cap] + windowMs);
}

export function checkSendLimits(input: {
  now: Date;
  recent: readonly RecentSend[];
  /** The recipients of the send that wants to start. */
  to: readonly string[];
  limits: SendLimits;
}): SendLimitResult {
  const { now, recent, limits } = input;
  const nowMs = now.getTime();
  const inWindow = (kind: SendLimitKind): RecentSend[] =>
    recent.filter((send) => send.startedAt.getTime() > nowMs - SEND_LIMIT_WINDOW_MS[kind]);

  // Order matters: on equal `until` the first kind wins.
  const holds: { limit: SendLimitKind; until: Date }[] = [];
  const hour = windowUntil(
    inWindow("mailbox_hour").map((send) => send.startedAt),
    limits.mailboxHour,
    SEND_LIMIT_WINDOW_MS.mailbox_hour
  );
  if (hour) holds.push({ limit: "mailbox_hour", until: hour });

  const day = inWindow("mailbox_day");
  const dayUntil = windowUntil(
    day.map((send) => send.startedAt),
    limits.mailboxDay,
    SEND_LIMIT_WINDOW_MS.mailbox_day
  );
  if (dayUntil) holds.push({ limit: "mailbox_day", until: dayUntil });

  // A recent send with an empty `to` counts only for the two mailbox windows.
  const dayRecipients = inWindow("recipient_day").map((send) => ({
    startedAt: send.startedAt,
    to: new Set(send.to.map(normalizeAddress)),
  }));
  for (const address of new Set(input.to.map(normalizeAddress))) {
    const until = windowUntil(
      dayRecipients.filter((send) => send.to.has(address)).map((send) => send.startedAt),
      limits.recipientDay,
      SEND_LIMIT_WINDOW_MS.recipient_day
    );
    if (until) holds.push({ limit: "recipient_day", until });
  }

  let latest: { limit: SendLimitKind; until: Date } | null = null;
  for (const hold of holds) {
    if (latest === null || hold.until.getTime() > latest.until.getTime()) latest = hold;
  }
  return latest ? { kind: "held", ...latest } : { kind: "ok" };
}

/** `send_limit:<kind>` is the `actions.last_error` of a held send. */
export const SEND_LIMIT_ERROR_PREFIX = "send_limit:";

export function sendLimitError(limit: SendLimitKind): string {
  return `${SEND_LIMIT_ERROR_PREFIX}${limit}`;
}

export function sendLimitOfError(lastError: string | null): SendLimitKind | null {
  if (lastError === null || !lastError.startsWith(SEND_LIMIT_ERROR_PREFIX)) return null;
  const rest = lastError.slice(SEND_LIMIT_ERROR_PREFIX.length);
  return sendLimitKinds.find((kind) => kind === rest) ?? null;
}
