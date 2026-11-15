import { z } from "./zod";

// GET/POST /api/delegates and PATCH /api/delegates/:id (F102 ticket, D10). Every object is strict. The raw limits of the bodies are
// wider than the limits of the service (name 1–100 characters, address by `ADDRESS_PATTERN`, at most 10 tags of 1–30 characters
// after trim): the service decides the real limit and answers 400 `validation` with the field.
export const DELEGATE_LIST_MAX = 200;
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
