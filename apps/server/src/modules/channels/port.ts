import type { MembershipRole, OutMessage } from "@ea/core";

export type ChannelErrorKind = "soft" | "rate_limited" | "config" | "blocked" | "bad_request" | "other";

/** A channel failure. `code` is log-safe: it never holds a token, a message text or an inner error text. */
export class ChannelError extends Error {
  constructor(
    readonly kind: ChannelErrorKind,
    readonly code: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(`channel error ${code}`);
    this.name = "ChannelError";
  }
}

export interface ChatChannel {
  send(chatId: number, message: OutMessage): Promise<{ messageId: number }>;
  edit(chatId: number, messageId: number, message: OutMessage): Promise<void>;
}

/** A private chat bound to one member of one organization. */
export interface LinkedChat {
  orgId: string;
  userId: string;
  role: MembershipRole;
  chatId: number;
  linkedAt: Date;
}
