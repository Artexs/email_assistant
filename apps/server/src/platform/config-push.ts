import { z } from "zod";

import { emptyAsUndefined } from "./config-shared";
import { decodeBase64Url, PUBLIC_KEY_BYTES, vapidPublicKeyOf } from "./vapid-keys";

// The env keys of Web Push. `config.ts` spreads them into the schema.
export const pushShape = {
  // Web Push (RFC 8292): the VAPID key pair (raw P-256, base64url) and the contact URI. All three or none. Secret: never print or log.
  VAPID_PUBLIC_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  VAPID_SUBJECT: z.preprocess(emptyAsUndefined, z.string().optional()),
};

type PushConfig = z.infer<z.ZodObject<typeof pushShape>>;

const vapidKeyNames = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
const VAPID_SUBJECT = /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+(\/\S*)?)$/;

// All three or none. A message names the key or a fixed code, never a value (the keys are secrets).
export function checkVapid(config: PushConfig, ctx: z.RefinementCtx): void {
  const missing = vapidKeyNames.filter((key) => config[key] === undefined);
  if (missing.length === vapidKeyNames.length) return;
  for (const key of missing)
    ctx.addIssue({ code: "custom", path: [key], message: "needed when another VAPID_* key is set" });
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = config;
  if (subject !== undefined && !VAPID_SUBJECT.test(subject)) {
    ctx.addIssue({ code: "custom", path: ["VAPID_SUBJECT"], message: "must be a mailto: or https: URI" });
  }
  if (publicKey !== undefined && decodeBase64Url(publicKey)?.length !== PUBLIC_KEY_BYTES) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "must be base64url of a 65-byte P-256 point" });
  }
  if (privateKey === undefined) return;
  const derived = vapidPublicKeyOf(privateKey);
  if (derived === null) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PRIVATE_KEY"], message: "must be base64url of a 32-byte P-256 key" });
  } else if (publicKey !== undefined && publicKey !== derived) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "vapid_key_mismatch" });
  }
}

/** The VAPID keys for Web Push, or null when none is set (`configSchema` has checked that all three are set, or none). */
export function pushConfigOf(config: PushConfig): { publicKey: string; privateKey: string; subject: string } | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = config;
  if (publicKey === undefined || privateKey === undefined || subject === undefined) return null;
  return { publicKey, privateKey, subject };
}
