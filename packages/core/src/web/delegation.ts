import { z } from "./zod";

export { ADDRESS_PATTERN } from "../triage/payloads";

// GET/POST /api/delegates and PATCH /api/delegates/:id (F102 ticket, D10). Every object is strict. The raw limits of the bodies are
// wider than the limits of the service (name 1–100 characters, address by `ADDRESS_PATTERN`, at most 10 tags of 1–30 characters
// after trim): the service decides the real limit and answers 400 `validation` with the field.
export const DELEGATE_LIST_MAX = 200;
// The limits of the service, one list for the service and the form of the panel (the server check is the real one).
export const DELEGATE_NAME_MAX = 100;
export const DELEGATE_TAGS_MAX = 10;
export const DELEGATE_TAG_MAX = 30;
export const DELEGATE_NAME_RAW_MAX = 400;
export const DELEGATE_EMAIL_RAW_MAX = 320;
export const DELEGATE_TAGS_RAW_MAX = 50;
export const DELEGATE_TAG_RAW_MAX = 200;

export const delegateSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  tags: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Delegate = z.infer<typeof delegateSchema>;

// Active delegates first, then by name; at most `DELEGATE_LIST_MAX`.
export const delegateListSchema = z.strictObject({ items: z.array(delegateSchema).max(DELEGATE_LIST_MAX) });
export type DelegateList = z.infer<typeof delegateListSchema>;

const tagsSchema = z.array(z.string().max(DELEGATE_TAG_RAW_MAX)).max(DELEGATE_TAGS_RAW_MAX);

export const delegateAddBodySchema = z.strictObject({
  name: z.string().max(DELEGATE_NAME_RAW_MAX),
  email: z.string().max(DELEGATE_EMAIL_RAW_MAX),
  tags: tagsSchema,
});
export type DelegateAddBody = z.infer<typeof delegateAddBodySchema>;

// D10: the address never changes, so the body has no `email` (a strict object refuses it). At least one field.
export const delegatePatchBodySchema = z
  .strictObject({
    name: z.string().max(DELEGATE_NAME_RAW_MAX).optional(),
    tags: tagsSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.tags !== undefined || body.active !== undefined, {
    message: "name, tags or active is required",
  });
export type DelegatePatchBody = z.infer<typeof delegatePatchBodySchema>;

// GET /api/delegations and the two POST routes (F102 stage 15). The list answers one page of delegations by state, newest
// first; `kind` is always `delegation` (E5b adds loop kinds to the same list). The task text and the subject never go to a log.
export const DELEGATION_PAGE_SIZE = 50;
export const DELEGATION_MAX_LIMIT = 100;
export const delegationFilters = ["open", "overdue", "answered", "closed"] as const;
export type DelegationFilter = (typeof delegationFilters)[number];
export const DELEGATION_DEFAULT_FILTER: DelegationFilter = "open";
export const delegationStatuses = ["drafted", "sent", "answered", "overdue", "done", "cancelled"] as const;

export const delegationListQuerySchema = z.object({
  filter: z.enum(delegationFilters).optional(),
  before: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(DELEGATION_MAX_LIMIT).optional(),
});
export type DelegationListQuery = z.infer<typeof delegationListQuerySchema>;

export const delegationItemSchema = z.strictObject({
  kind: z.literal("delegation"),
  id: z.uuid(),
  status: z.enum(delegationStatuses),
  delegate: z.strictObject({ id: z.uuid(), name: z.string(), email: z.string(), active: z.boolean() }),
  // null after retention cleared the task text.
  task: z.string().nullable(),
  subject: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  answeredAt: z.iso.datetime().nullable(),
  remindersSent: z.number().int().min(0),
  // A reminder send of this delegation waits for a tap or is on its way out.
  reminderWaiting: z.boolean(),
  // The send that the page links to `/approvals?id=` while the delegation is `drafted`, else null.
  sendId: z.uuid().nullable(),
});
export type DelegationItem = z.infer<typeof delegationItemSchema>;

export const delegationListSchema = z.strictObject({
  items: z.array(delegationItemSchema).max(DELEGATION_MAX_LIMIT),
  next: z.string().nullable(),
});
export type DelegationList = z.infer<typeof delegationListSchema>;

export const delegationDoneAnswerSchema = z.strictObject({ status: z.literal("done") });
export type DelegationDoneAnswer = z.infer<typeof delegationDoneAnswerSchema>;
export const delegationCancelAnswerSchema = z.strictObject({ status: z.literal("cancelled") });
export type DelegationCancelAnswer = z.infer<typeof delegationCancelAnswerSchema>;
export const delegationRemindAnswerSchema = z.strictObject({ status: z.literal("planned"), sendId: z.uuid() });
export type DelegationRemindAnswer = z.infer<typeof delegationRemindAnswerSchema>;

// The body of all three POST routes is empty (`{}`); a strict object refuses any field.
export const delegationActionBodySchema = z.strictObject({});
