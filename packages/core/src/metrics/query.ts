// The shape of one metric query. Structural: the readers of every module take it without importing each other.
export interface WeekQuery {
  /** `start ≤ t < end` everywhere. */
  range: { start: Date; end: Date };
  /** null = every mailbox of the organization. */
  mailboxId: string | null;
  /** Same shape as the `TestMailRule` of the mail module. */
  testMail: { senders: readonly string[] };
}
