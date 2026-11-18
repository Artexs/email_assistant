import { z } from "./zod";

// The push devices of the own user (`/api/me/push`). The endpoint and the keys come from the browser (`PushSubscription`): the body
// is untrusted, so every field has a hard size limit. No answer holds an endpoint or a key.

/** The longest endpoint that the body accepts. Real endpoints are 100 to 700 characters. */
export const PUSH_ENDPOINT_MAX = 1024;
/** Base64url of the 65-byte P-256 key is 87 characters; of the 16-byte auth secret, 22. Browsers send no `=` padding: the pattern refuses it. */
export const PUSH_P256DH_MAX = 100;
export const PUSH_AUTH_MAX = 50;

const base64UrlKey = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, "bad_key");

export const pushSubscriptionBodySchema = z.strictObject({
  endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX),
  keys: z.strictObject({ p256dh: base64UrlKey(PUSH_P256DH_MAX), auth: base64UrlKey(PUSH_AUTH_MAX) }),
  // A page load: re-bind a device of this user that exists; a new device needs the click.
  rebindOnly: z.boolean().optional(),
});
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;

export const pushSubscriptionAnswerSchema = z.object({ id: z.uuid() });
export type PushSubscriptionAnswer = z.infer<typeof pushSubscriptionAnswerSchema>;

export const pushDeviceViewSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastSuccessAt: z.iso.datetime().nullable(),
  // The device is bound to the session of this request.
  thisSession: z.boolean(),
});
export type PushDeviceView = z.infer<typeof pushDeviceViewSchema>;

export const pushStateSchema = z.object({
  // null: the server has no VAPID keys (Web Push is off).
  vapidPublicKey: z.string().nullable(),
  devices: z.array(pushDeviceViewSchema),
});
export type PushState = z.infer<typeof pushStateSchema>;

export const pushTestAnswerSchema = z.object({ sent: z.number().int().min(0) });
export type PushTestAnswer = z.infer<typeof pushTestAnswerSchema>;
