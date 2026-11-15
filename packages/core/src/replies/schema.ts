import { z } from "zod";

// What the drafter must return. Strict: an extra or a missing key is a schema failure. The model never gives a
// recipient, a folder or a command: no field can hold one. The server derives the gaps from the body, so the `gaps`
// field is not trusted.
export const DRAFTER_BODY_MAX = 10_000;

export const noDraftReasons = ["needs_facts", "not_a_reply", "unsafe_request"] as const;
export type NoDraftReason = (typeof noDraftReasons)[number];

export const drafterOutputSchema = z
  .object({
    decision: z.enum(["draft", "no_draft"]),
    reason_code: z.enum(noDraftReasons).nullable(),
    body: z.string().max(DRAFTER_BODY_MAX),
    gaps: z.array(z.string().max(200)).max(20),
    language: z.enum(["pl", "en"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "draft" && value.reason_code !== null)
      ctx.addIssue({ code: "custom", path: ["reason_code"], message: "reason_code must be null for a draft" });
    if (value.decision === "draft" && value.body.trim() === "")
      ctx.addIssue({ code: "custom", path: ["body"], message: "a draft needs a body" });
    if (value.decision === "no_draft" && value.reason_code === null)
      ctx.addIssue({ code: "custom", path: ["reason_code"], message: "no_draft needs a reason_code" });
  });
export type DrafterOutput = z.infer<typeof drafterOutputSchema>;
