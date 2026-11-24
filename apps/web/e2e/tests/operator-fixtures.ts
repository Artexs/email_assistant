import {
  operatorNoticesSchema,
  operatorOrgDetailSchema,
  operatorOrgListSchema,
  type OperatorNotices,
  type OperatorOrgDetail,
  type OperatorOrgList,
} from "@ea/core/web";

// What the operator API answers in the spec. The e2e seed has no operator user, so the spec answers these three reads itself.
// Each object is parsed with its schema when this file loads: a schema change fails the spec, not the screen.
// Ids, codes, counts and dates only, like the API (no name, no address).

const AT = "2026-11-24T10:00:00.000Z";
const LLM = { since: "2026-11-24T00:00:00.000Z", calls: 12, costUsd: 0.0421, unpricedCalls: 0 };

export const ORG_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

const MAILBOX_IDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
] as const;

export const orgList: OperatorOrgList = operatorOrgListSchema.parse({
  at: AT,
  orgs: [
    {
      orgId: ORG_IDS[0],
      plan: "trial",
      trialEndsAt: "2026-12-01T00:00:00.000Z",
      resumedAt: null,
      maxMailboxes: 3,
      members: 2,
      linkedChats: 1,
      mailboxes: { total: 2, active: 1, paused: 0, authError: 1, hostBlocked: 0 },
      lastSyncAt: "2026-11-24T09:55:00.000Z",
      failures24h: { sends: 0, outbox: 1 },
      llmToday: LLM,
    },
    {
      orgId: ORG_IDS[1],
      plan: "active",
      trialEndsAt: null,
      resumedAt: null,
      maxMailboxes: 5,
      members: 4,
      linkedChats: 2,
      mailboxes: { total: 3, active: 2, paused: 0, authError: 0, hostBlocked: 1 },
      lastSyncAt: "2026-11-24T09:58:00.000Z",
      failures24h: { sends: 2, outbox: 0 },
      llmToday: LLM,
    },
    {
      orgId: ORG_IDS[2],
      plan: "suspended",
      trialEndsAt: "2026-11-10T00:00:00.000Z",
      resumedAt: null,
      maxMailboxes: 1,
      members: 1,
      linkedChats: 0,
      mailboxes: { total: 1, active: 1, paused: 0, authError: 0, hostBlocked: 0 },
      lastSyncAt: null,
      failures24h: { sends: 0, outbox: 0 },
      llmToday: { ...LLM, calls: 0, costUsd: 0 },
    },
  ],
});

// The detail of the second organization: both bad mailbox states and a company sign-in block. The other two get a short detail.
export function orgDetail(orgId: string): OperatorOrgDetail {
  const second = orgId === ORG_IDS[1];
  return operatorOrgDetailSchema.parse({
    orgId,
    plan: second ? "active" : "trial",
    trialEndsAt: second ? null : "2026-12-01T00:00:00.000Z",
    resumedAt: null,
    maxMailboxes: second ? 5 : 3,
    mailboxes: second
      ? [
          {
            mailboxId: MAILBOX_IDS[0],
            status: "auth_error",
            statusChangedAt: "2026-11-24T08:00:00.000Z",
            lastSyncedAt: "2026-11-23T20:00:00.000Z",
          },
          {
            mailboxId: MAILBOX_IDS[1],
            status: "host_blocked",
            statusChangedAt: "2026-11-24T09:00:00.000Z",
            lastSyncedAt: null,
          },
          {
            mailboxId: MAILBOX_IDS[2],
            status: "active",
            statusChangedAt: "2026-11-20T09:00:00.000Z",
            lastSyncedAt: "2026-11-24T09:58:00.000Z",
          },
        ]
      : [],
    lastRuns: {
      sync: "2026-11-24T09:58:00.000Z",
      triage: "2026-11-24T09:57:00.000Z",
      digest: "2026-11-24T07:00:00.000Z",
      send: null,
      notice: "2026-11-24T09:30:00.000Z",
    },
    failures24h: { sends: second ? 2 : 0, outbox: 0 },
    llmToday: LLM,
    flags: [
      { flag: "approvals_page", enabled: true, source: "row" },
      { flag: "stats_page", enabled: false, source: "default" },
      { flag: "delegation_pages", enabled: false, source: "env" },
    ],
    sso: second
      ? { domain: "example.test", proof: "dns", required: true, linkedMembers: 3, breakGlassReady: true }
      : null,
    at: AT,
  });
}

export const notices: OperatorNotices = operatorNoticesSchema.parse({
  since: "2026-11-17T10:00:00.000Z",
  notices: [
    { orgId: ORG_IDS[0], kind: "mailbox_auth_error", key: "k1", at: "2026-11-24T09:00:00.000Z" },
    { orgId: ORG_IDS[1], kind: "mailbox_host_blocked", key: "k2", at: "2026-11-24T08:30:00.000Z" },
    { orgId: ORG_IDS[1], kind: "send_failed", key: "k3", at: "2026-11-23T17:10:00.000Z" },
    { orgId: ORG_IDS[2], kind: "trial_ended", key: "k4", at: "2026-11-10T00:05:00.000Z" },
    { orgId: ORG_IDS[0], kind: "outbox_failed", key: "k5", at: "2026-11-09T12:00:00.000Z" },
  ],
});
