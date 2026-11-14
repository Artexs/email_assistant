import { z } from "./zod";

// The web imports core only through @ea/core/web, so the kinds are re-exported here.
export { securityEventKinds, type SecurityEventKind } from "../security-log";

// GET /api/security-log (F099 D26, D27): no IP, no e-mail address, no user id.
export const securityLogActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("member"), name: z.string() }),
  z.strictObject({ kind: z.literal("former_member") }),
  z.strictObject({ kind: z.literal("operator") }),
  z.strictObject({ kind: z.literal("system") }),
]);

export const securityLogEntrySchema = z.strictObject({
  at: z.iso.datetime(),
  kind: z.string(), // a SecurityEventKind; a string so an older web build never fails on a new kind
  actor: securityLogActorSchema,
  lockedUntil: z.iso.datetime().nullable(),
});

export const securityLogSchema = z.strictObject({ entries: z.array(securityLogEntrySchema) });

export type SecurityLogActor = z.infer<typeof securityLogActorSchema>;
export type SecurityLogEntry = z.infer<typeof securityLogEntrySchema>;
export type SecurityLog = z.infer<typeof securityLogSchema>;
