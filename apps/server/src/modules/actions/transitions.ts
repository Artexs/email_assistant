// Source of truth for `actions.status` edges. A new status write must update this file;
// `transitions.test.ts` and `actions-transitions.test.ts` fail otherwise.
//
// This file is data only. No runtime code imports it (D3: the runtime step is a separate task).
// - `ACTION_ENTRIES`: how a new row gets its first status.
// - `ACTION_EDGES`: the edges that callers use (design map). One row per (writer, from, to).
// - `WRITER_GUARDS`: the guard of each writer variant, as the repository code writes it.
// - `LATENT_EDGES`: edges that a guard admits and no caller uses.
// Rule (test A): the edges that the guards admit = `ACTION_EDGES` + `LATENT_EDGES`, compared per type.
// Callers are file names (no line numbers: lines move).
import type { ActionType } from "@ea/core";

export const ACTION_STATUSES = [
  "ready",
  "applying",
  "applied",
  "awaiting_approval",
  "approved",
  "rejected",
  "expired",
  "undone",
  "logged",
  "failed",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

// No edge leaves these statuses on the same row. `applied` is not terminal (`applied` -> `undone`).
export const TERMINAL_STATUSES: readonly ActionStatus[] = ["rejected", "expired", "undone", "logged", "failed"];

export type ActionWriter =
  | "createPlanned"
  | "insertReverse"
  | "insertSendAgain"
  | "markApplying"
  | "finishAction"
  | "releaseAction"
  | "expireStaleReady"
  | "expireReadyOriginals"
  | "expireReadyDraft"
  | "setExpired"
  | "setApproved"
  | "setRejected"
  | "markUndone";

export interface ActionEntry {
  status: ActionStatus;
  types: readonly ActionType[];
  writer: ActionWriter;
  callers: readonly string[];
}

export interface ActionEdge {
  id: string;
  from: ActionStatus;
  to: ActionStatus;
  types: readonly ActionType[];
  writer: ActionWriter;
  reasons: readonly string[];
  // The row is released for a later try (the lock clears). The status can stay (E9, E11, E12) or change (E10, E13).
  retry?: true;
  callers: readonly string[];
}

// One row per writer variant. `from` lists, per type, the statuses that the guard admits for a row
// that the database can hold (a `send` is never `ready`: `actions_send_never_ready_check`).
// A type that is not a key is not admitted, cannot exist in the status of the `to` list, or has no caller for
// this variant (the `finishAction` variants with an explicit `from`: see their comment). Tests check only the keys.
// `to` lists the statuses that the variant can write. `held: "blocks"`: a row with a fresh `locked_at` is not changed.
export interface WriterGuard {
  writer: ActionWriter;
  variant: string;
  from: Readonly<Partial<Record<ActionType, readonly ActionStatus[]>>>;
  to: readonly ActionStatus[];
  held?: "blocks";
}

export interface LatentEdge {
  writer: ActionWriter;
  from: ActionStatus;
  to: ActionStatus;
  types: readonly ActionType[];
  why: string;
}

export interface PairRule {
  id: string;
  when: string;
  then: string;
  enforcedBy: readonly string[];
  // Name of the integration test that proves the rule, or "none".
  test: string;
}

const MAILBOX: readonly ActionType[] = ["move", "mark_read", "flag"];
const NON_SEND: readonly ActionType[] = ["move", "mark_read", "flag", "save_summary", "create_draft"];
const ALL_TYPES: readonly ActionType[] = [...NON_SEND, "send"];

// --- Entry writers ---------------------------------------------------------------------------------------------

export const ACTION_ENTRIES: readonly ActionEntry[] = [
  // `triage/service.ts` takes the status from `actionStatusFor`; `delegation/chaser.ts` hard-codes it.
  { status: "ready", types: NON_SEND, writer: "createPlanned", callers: ["triage/service.ts", "delegation/chaser.ts"] },
  {
    status: "awaiting_approval",
    types: ["send"],
    writer: "createPlanned",
    callers: ["triage/service.ts", "delegation/chaser.ts"],
  },
  { status: "logged", types: ALL_TYPES, writer: "createPlanned", callers: ["triage/service.ts"] },
  // The reverse row of an undo (mailbox types) or of a draft whose send ended (`create_draft`).
  {
    status: "ready",
    types: [...MAILBOX, "create_draft"],
    writer: "insertReverse",
    callers: ["undo.ts", "expiry.ts", "send.ts"],
  },
  // "Send again" on a failed send: a new `approved` send row (key `<id>:again`) with `approved_at`.
  { status: "approved", types: ["send"], writer: "insertSendAgain", callers: ["approvals.ts"] },
];

// --- Edges that callers use ------------------------------------------------------------------------------------

export const ACTION_EDGES: readonly ActionEdge[] = [
  {
    id: "E1",
    from: "ready",
    to: "applied",
    types: [...MAILBOX, "save_summary", "create_draft"], // `create_draft`: reverse rows only
    writer: "finishAction",
    reasons: [],
    callers: ["apply.ts", "drafts.ts"],
  },
  {
    id: "E2",
    from: "ready",
    to: "applying",
    types: ["create_draft"],
    writer: "markApplying",
    reasons: [],
    callers: ["drafts.ts"],
  },
  {
    id: "E3",
    from: "approved",
    to: "applying",
    types: ["send"],
    writer: "markApplying",
    reasons: [],
    callers: ["send.ts"],
  },
  {
    id: "E4",
    from: "applying",
    to: "applied",
    types: ["create_draft", "send"],
    writer: "finishAction",
    reasons: ["recovered"], // send recovery: `recovered` in `provider_result`
    callers: ["drafts.ts", "send.ts"],
  },
  {
    id: "E5",
    from: "ready",
    to: "failed",
    types: [...MAILBOX, "create_draft"], // `create_draft`: reverse rows only
    writer: "finishAction",
    reasons: ["hard_error", "mail_not_found", "bad_payload"],
    callers: ["apply.ts", "drafts.ts"],
  },
  {
    id: "E6",
    from: "applying",
    to: "failed",
    types: ["create_draft", "send"],
    writer: "finishAction",
    reasons: ["hard_error", "bad_payload", "smtp_rejected", "smtp_error", "outcome_unknown"],
    callers: ["drafts.ts", "send.ts"],
  },
  {
    id: "E7",
    from: "approved",
    to: "failed",
    types: ["send"],
    writer: "finishAction",
    reasons: ["bad_payload", "smtp_error"], // `smtp_error`: the third compose error
    callers: ["send.ts"],
  },
  {
    id: "E8",
    from: "applying",
    to: "expired",
    types: ["create_draft"],
    writer: "finishAction",
    reasons: ["send_closed"],
    callers: ["drafts.ts"],
  },
  {
    id: "E9",
    from: "ready",
    to: "ready",
    types: [...MAILBOX, "create_draft"],
    writer: "releaseAction",
    reasons: ["soft error: no count", "hard error: attempts + 1", "no provider"],
    retry: true,
    callers: ["apply.ts", "drafts.ts"],
  },
  {
    id: "E10",
    from: "applying",
    to: "ready",
    types: ["create_draft"],
    writer: "releaseAction",
    reasons: ["error before the APPEND, in a row that this call started"],
    retry: true,
    callers: ["drafts.ts"],
  },
  {
    id: "E11",
    from: "applying",
    to: "applying",
    types: ["create_draft", "send"],
    writer: "releaseAction",
    reasons: ["draft: error at the APPEND", "send: error in the recovery", "no provider"],
    retry: true,
    callers: ["apply.ts", "drafts.ts", "send.ts"],
  },
  {
    id: "E12",
    from: "approved",
    to: "approved",
    types: ["send"],
    writer: "releaseAction",
    reasons: ["no sender", "draft not applied", "compose error", "no provider"],
    retry: true,
    callers: ["apply.ts", "send.ts"],
  },
  {
    id: "E13",
    from: "applying",
    to: "approved",
    types: ["send"],
    writer: "releaseAction",
    reasons: ["login error (auth_error)", "known stage before the content"],
    retry: true,
    callers: ["send.ts"],
  },
  {
    id: "E14a",
    from: "ready",
    to: "expired",
    types: MAILBOX,
    writer: "expireStaleReady",
    reasons: ["stale"],
    callers: ["committer.ts"],
  },
  {
    id: "E14b",
    from: "ready",
    to: "expired",
    types: MAILBOX,
    writer: "expireReadyOriginals",
    reasons: ["policy_changed", "undo", "manual"],
    callers: ["expire.ts", "undo.ts", "config/service.ts", "scripts/mailbox-settings.ts"],
  },
  {
    id: "E14c",
    from: "ready",
    to: "expired",
    types: ["create_draft"],
    writer: "expireReadyDraft",
    reasons: ["send_closed"],
    callers: ["expiry.ts"],
  },
  {
    id: "E15",
    from: "awaiting_approval",
    to: "approved",
    types: ["send"],
    writer: "setApproved",
    reasons: [],
    callers: ["approvals.ts"],
  },
  {
    id: "E16",
    from: "awaiting_approval",
    to: "rejected",
    types: ["send"],
    writer: "setRejected",
    reasons: ["rejected"],
    callers: ["approvals.ts"],
  },
  {
    id: "E17",
    from: "approved",
    to: "rejected",
    types: ["send"],
    writer: "setRejected",
    reasons: ["rejected"], // only when the row is not held
    callers: ["approvals.ts"],
  },
  {
    id: "E18",
    from: "awaiting_approval",
    to: "expired",
    types: ["send"],
    writer: "setExpired",
    reasons: ["timeout", "draft_missing", "not_notified", "not_seen", "policy_changed", "delegation_closed"],
    callers: ["expiry.ts"], // through `expireSend`: approvals.ts, drafts.ts, expire.ts, expiry.ts
  },
  {
    id: "E19",
    from: "approved",
    to: "expired",
    types: ["send"],
    writer: "setExpired",
    reasons: ["held_timeout", "delegation_closed"], // only when the row is not held
    callers: ["expiry.ts"],
  },
  {
    id: "E20",
    from: "applied",
    to: "undone",
    types: [...MAILBOX, "create_draft"],
    writer: "markUndone",
    reasons: ["undo", "user_moved_back", "sent", "rejected", "expired"],
    callers: ["apply.ts", "drafts.ts", "triage/returned.ts"],
  },
];

// --- Guards ----------------------------------------------------------------------------------------------------

export const WRITER_GUARDS: readonly WriterGuard[] = [
  {
    writer: "markApplying",
    variant: "default",
    // A send needs `approved` with `approved_at`; the other types start from `ready` or `approved`.
    from: {
      move: ["ready", "approved"],
      mark_read: ["ready", "approved"],
      flag: ["ready", "approved"],
      save_summary: ["ready", "approved"],
      create_draft: ["ready", "approved"],
      send: ["approved"],
    },
    to: ["applying"],
  },
  {
    writer: "finishAction",
    variant: "default",
    // `from` defaults to `ready`, `applying`. A send is never `ready`.
    from: {
      move: ["ready", "applying"],
      mark_read: ["ready", "applying"],
      flag: ["ready", "applying"],
      save_summary: ["ready", "applying"],
      create_draft: ["ready", "applying"],
      send: ["applying"],
    },
    to: ["applied", "failed", "expired"],
  },
  // `from: ["applying"]` and `from: ["approved"]`: only send callers pass them, so the map lists them for `send` only.
  // The SQL has no type guard. A non-send row is never `approved`; a non-send `applying` row with an explicit
  // `from` has no caller. If a non-send caller passes `from`, add its types here and test A shows the new edges.
  {
    writer: "finishAction",
    variant: `from ["applying"]`,
    from: { send: ["applying"] },
    to: ["applied", "failed", "expired"],
  },
  {
    writer: "finishAction",
    variant: `from ["approved"]`,
    from: { send: ["approved"] },
    to: ["applied", "failed", "expired"],
  },
  {
    // The target is a parameter. A send is never `ready`, so it has no `toStatus: "ready"` variant.
    writer: "releaseAction",
    variant: `toStatus "ready"`,
    from: {
      move: ["ready", "approved", "applying"],
      mark_read: ["ready", "approved", "applying"],
      flag: ["ready", "approved", "applying"],
      save_summary: ["ready", "approved", "applying"],
      create_draft: ["ready", "approved", "applying"],
    },
    to: ["ready"],
  },
  {
    writer: "releaseAction",
    variant: `toStatus "approved"`,
    from: {
      move: ["ready", "approved", "applying"],
      mark_read: ["ready", "approved", "applying"],
      flag: ["ready", "approved", "applying"],
      save_summary: ["ready", "approved", "applying"],
      create_draft: ["ready", "approved", "applying"],
      send: ["approved", "applying"],
    },
    to: ["approved"],
  },
  {
    writer: "releaseAction",
    variant: `toStatus "applying"`,
    from: {
      move: ["ready", "approved", "applying"],
      mark_read: ["ready", "approved", "applying"],
      flag: ["ready", "approved", "applying"],
      save_summary: ["ready", "approved", "applying"],
      create_draft: ["ready", "approved", "applying"],
      send: ["approved", "applying"],
    },
    to: ["applying"],
  },
  {
    writer: "expireStaleReady",
    variant: "default",
    from: { move: ["ready"], mark_read: ["ready"], flag: ["ready"] },
    to: ["expired"],
    held: "blocks",
  },
  {
    writer: "expireReadyOriginals",
    variant: "default",
    from: { move: ["ready"], mark_read: ["ready"], flag: ["ready"] },
    to: ["expired"],
    held: "blocks",
  },
  { writer: "expireReadyDraft", variant: "default", from: { create_draft: ["ready"] }, to: ["expired"] },
  { writer: "setExpired", variant: `from "awaiting_approval"`, from: { send: ["awaiting_approval"] }, to: ["expired"] },
  { writer: "setExpired", variant: `from "approved"`, from: { send: ["approved"] }, to: ["expired"], held: "blocks" },
  { writer: "setApproved", variant: "default", from: { send: ["awaiting_approval"] }, to: ["approved"] },
  {
    writer: "setRejected",
    variant: `from "awaiting_approval"`,
    from: { send: ["awaiting_approval"] },
    to: ["rejected"],
  },
  { writer: "setRejected", variant: `from "approved"`, from: { send: ["approved"] }, to: ["rejected"], held: "blocks" },
  {
    // No type guard: only the status `applied` is checked.
    writer: "markUndone",
    variant: "default",
    from: {
      move: ["applied"],
      mark_read: ["applied"],
      flag: ["applied"],
      save_summary: ["applied"],
      create_draft: ["applied"],
      send: ["applied"],
    },
    to: ["undone"],
  },
];

// --- Latent edges ----------------------------------------------------------------------------------------------
// A guard admits each edge below. No caller uses it. Closing them is the runtime follow-up task (D3).

export const LATENT_EDGES: readonly LatentEdge[] = [
  // L2: markApplying admits more than E2 and E3.
  {
    writer: "markApplying",
    from: "ready",
    to: "applying",
    types: [...MAILBOX, "save_summary"],
    why: "L2: only a draft starts through markApplying",
  },
  {
    writer: "markApplying",
    from: "approved",
    to: "applying",
    types: NON_SEND,
    why: "L2: only a send is `approved`; setApproved needs type send",
  },
  // L3, L5, L6, L8: finishAction with its default `from`, and with `from: ["approved"]`.
  {
    writer: "finishAction",
    from: "ready",
    to: "expired",
    types: [...MAILBOX, "save_summary", "create_draft"],
    why: "L3/L8: `send_closed` is for an `applying` draft; an original draft is never `ready` at the end of a flow",
  },
  {
    writer: "finishAction",
    from: "ready",
    to: "failed",
    types: ["save_summary"],
    why: "L8: only mailbox types and reverse drafts fail from `ready`",
  },
  {
    writer: "finishAction",
    from: "applying",
    to: "applied",
    types: [...MAILBOX, "save_summary"],
    why: "only a draft or a send is `applying`",
  },
  {
    writer: "finishAction",
    from: "applying",
    to: "failed",
    types: [...MAILBOX, "save_summary"],
    why: "only a draft or a send is `applying`",
  },
  {
    writer: "finishAction",
    from: "applying",
    to: "expired",
    types: [...MAILBOX, "save_summary", "send"],
    why: "L6: `send_closed` is for a draft only",
  },
  {
    writer: "finishAction",
    from: "approved",
    to: "applied",
    types: ["send"],
    why: "L5: the only caller with `from: [approved]` passes `failed`",
  },
  {
    writer: "finishAction",
    from: "approved",
    to: "expired",
    types: ["send"],
    why: "L5: the only caller with `from: [approved]` passes `failed`",
  },
  // L1: releaseAction has no type guard, and its target is a parameter.
  {
    writer: "releaseAction",
    from: "ready",
    to: "ready",
    types: ["save_summary"],
    why: "apply.ts skips `save_summary` before the release",
  },
  {
    writer: "releaseAction",
    from: "applying",
    to: "ready",
    types: [...MAILBOX, "save_summary"],
    why: "L1: only a draft goes `applying` -> `ready`",
  },
  { writer: "releaseAction", from: "approved", to: "ready", types: NON_SEND, why: "L1" },
  { writer: "releaseAction", from: "ready", to: "approved", types: NON_SEND, why: "L1" },
  { writer: "releaseAction", from: "approved", to: "approved", types: NON_SEND, why: "L1: only a send is `approved`" },
  {
    writer: "releaseAction",
    from: "applying",
    to: "approved",
    types: NON_SEND,
    why: "L1: only a send goes back to `approved`",
  },
  { writer: "releaseAction", from: "ready", to: "applying", types: NON_SEND, why: "L1" },
  { writer: "releaseAction", from: "approved", to: "applying", types: ALL_TYPES, why: "L1" },
  {
    writer: "releaseAction",
    from: "applying",
    to: "applying",
    types: [...MAILBOX, "save_summary"],
    why: "L1: only a draft or a send is `applying`",
  },
  // L4, L7: markUndone has no type guard.
  {
    writer: "markUndone",
    from: "applied",
    to: "undone",
    types: ["send", "save_summary"],
    why: "L4/L7: no type guard, no caller",
  },
];

// --- Pair rules (two rows move together) -----------------------------------------------------------------------
// No runtime check (D8). `test` names the integration test that proves the rule, as `<file> › <title>` (a title can be a prefix of the real title).

export const PAIR_RULES: readonly PairRule[] = [
  {
    id: "P1",
    when: "a send is claimed",
    then: "its draft (`depends_on_action_id`) must be `applied`",
    enforcedBy: ["claimableWhere (repo/claims.ts)", "send.ts re-check (E12)"],
    test: "actions-repo.test.ts › 2: an approved send with an applied draft is claimed with the mail fields; actions-repo.test.ts › 1: a ready draft is claimed while its send waits; the send is not; actions-send.test.ts › a claimed send whose draft is no longer applied is released as approved with no count (P1 re-check)",
  },
  {
    id: "P2",
    when: "a draft (original) is claimed",
    then: "one of its sends must be `awaiting_approval`; else the draft ends `expired` (`send_closed`)",
    enforcedBy: ["sendWaits (repo/claims.ts)", "drafts.ts (E8)", "expiry.ts (E14c)"],
    test: "actions-repo.test.ts › 3: a draft waits for its send to wait too; actions-drafts.test.ts › a dead send: no APPEND, the draft expires with send_closed",
  },
  {
    id: "P3",
    when: "a draft ends `failed`",
    then: "its `awaiting_approval` sends expire (`draft_missing`)",
    enforcedBy: ["drafts.ts", "listExpiredApprovals (hourly job)"],
    test: "actions-drafts.test.ts › three hard APPEND errors fail the draft and expire its send; actions-expiry.test.ts › (3) failed draft: draft_missing",
  },
  {
    id: "P4",
    when: "a send ends (`applied`, `rejected`, `expired`)",
    then: "its draft: `ready` -> `expired`; `applied` with UIDPLUS -> a reverse row; the applied reverse row -> the draft `undone`",
    enforcedBy: ["closeDraftOfSend (expiry.ts)", "send.ts", "drafts.ts"],
    test: "actions-send.test.ts › (1) the happy path; actions-approvals.test.ts › rejected, a reverse draft row; actions-drafts.test.ts › the reverse row removes the draft and marks the original undone with the reason; actions-drafts.test.ts › a reverse row with the reason expired marks the original undone with that reason",
  },
  {
    id: "P5",
    when: `"Send again" on a \`failed\` send (smtp_error, outcome_unknown)`,
    then: "a new `approved` send row (key `<failed id>:again`); the failed row stays `failed`",
    enforcedBy: ["insertSendAgain", "approvals.ts"],
    test: "actions-approvals.test.ts › a failed send with an applied draft gets one new approved send",
  },
  {
    id: "P6",
    when: "a reverse row is `applied`",
    then: "its original goes `applied` -> `undone`",
    enforcedBy: ["markUndone in apply.ts", "markUndone in drafts.ts"],
    test: "actions-apply.test.ts › a reverse flag removes the flag and marks the original undone; actions-move.test.ts › (8)",
  },
  {
    id: "P7",
    when: "delegation hooks run (`DelegationHooks`)",
    then: "send applied: delegation `sent`; send failed or expired: delegation `cancelled`; delegation closed: its reminder sends expire",
    enforcedBy: ["send.ts", "expiry.ts", "expireReminderActions"],
    test: "actions-send.test.ts › (14) triage, draft, approval, send, the delegation is sent; actions-expiry.test.ts › (1)",
  },
];

// The statuses that a row of `type` can reach in one step, by the edges that callers use (not the latent edges).
export function nextStatuses(from: ActionStatus, type: ActionType): ActionStatus[] {
  const result = new Set<ActionStatus>();
  for (const edge of ACTION_EDGES) {
    if (edge.from === from && edge.types.includes(type)) {
      result.add(edge.to);
    }
  }
  return [...result];
}
