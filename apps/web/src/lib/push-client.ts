import { deviceOf, type PushSubscriptionBody } from "@ea/core/web";

// The browser side of Web Push: turn the public VAPID key into bytes, subscribe through the service worker and send the subscription
// to the server. Every browser object comes in as an argument, so a unit test runs the flow with fakes and no push service.
// The page only ever holds the PUBLIC key (the server answers it in `GET /api/me/push`). The subscription endpoint and keys go to
// the server and nowhere else: nothing here logs them.

/** Bytes of an unpadded base64url string (the form of the VAPID public key and of the subscription keys). */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Unpadded base64url: the server refuses `=` padding. */
export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type InstallHint = "installed" | "ios" | "android" | "other";

/** What the card says about installing the panel. An installed panel (`display-mode: standalone`) needs no help. */
export function installHint(userAgent: string, standalone: boolean): InstallHint {
  if (standalone) return "installed";
  const { os } = deviceOf(userAgent);
  if (os === "ios") return "ios";
  if (os === "android") return "android";
  return "other";
}

/** The part of a `PushSubscription` that the flow reads. */
export interface SubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null;
  unsubscribe?(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: true;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<SubscriptionLike>;
}

export type PermissionState = "default" | "granted" | "denied";

/** The body of `PUT /api/me/push/subscription`, or null when the browser gave no key (it cannot happen for a real subscription). */
export function subscriptionBody(subscription: SubscriptionLike, rebindOnly: boolean): PushSubscriptionBody | null {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (p256dh === null || auth === null) return null;
  const body: PushSubscriptionBody = {
    endpoint: subscription.endpoint,
    keys: { p256dh: bytesToBase64Url(p256dh), auth: bytesToBase64Url(auth) },
  };
  return rebindOnly ? { ...body, rebindOnly: true } : body;
}

export interface PushFlowDeps {
  permission(): PermissionState;
  requestPermission(): Promise<PermissionState>;
  pushManager(): Promise<PushManagerLike>;
  put(body: PushSubscriptionBody): Promise<void>;
}

export type EnableResult = "enabled" | "blocked" | "failed";

const sameBytes = (left: ArrayBuffer, right: Uint8Array): boolean => {
  const view = new Uint8Array(left);
  return view.length === right.length && view.every((byte, index) => byte === right[index]);
};

/**
 * The click: ask the permission when it is undecided (a denied or refused permission stops here, before any request), subscribe with the public key and send the
 * subscription. A subscription of an older server key makes `subscribe` throw: it is replaced.
 */
export async function enablePush(publicKey: string, deps: PushFlowDeps): Promise<EnableResult> {
  try {
    let permission = deps.permission();
    if (permission === "default") permission = await deps.requestPermission();
    if (permission !== "granted") return "blocked";

    const applicationServerKey = base64UrlToBytes(publicKey);
    const manager = await deps.pushManager();
    let subscription = await manager.getSubscription();
    const oldKey = subscription?.options?.applicationServerKey;
    if (subscription !== null && oldKey !== undefined && oldKey !== null && !sameBytes(oldKey, applicationServerKey)) {
      await subscription.unsubscribe?.();
      subscription = null;
    }
    subscription ??= await manager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const body = subscriptionBody(subscription, false);
    if (body === null) return "failed";
    await deps.put(body);
    return "enabled";
  } catch {
    return "failed";
  }
}

export type RebindResult = "sent" | "skipped" | "failed";

/** Each panel load: send an existing subscription again with `rebindOnly`, so the device follows the new session. Never subscribes. */
export async function rebindPush(deps: PushFlowDeps): Promise<RebindResult> {
  try {
    if (deps.permission() !== "granted") return "skipped";
    const subscription = await (await deps.pushManager()).getSubscription();
    if (subscription === null) return "skipped";
    const body = subscriptionBody(subscription, true);
    if (body === null) return "skipped";
    await deps.put(body);
    return "sent";
  } catch {
    return "failed";
  }
}

/** True when this browser can show web push at all. */
export function pushSupported(scope: {
  Notification?: unknown;
  PushManager?: unknown;
  navigator?: { serviceWorker?: unknown };
}): boolean {
  return (
    scope.Notification !== undefined && scope.PushManager !== undefined && scope.navigator?.serviceWorker !== undefined
  );
}

const WORKER_WAIT_MS = 10_000;

/** The push manager of the registered worker. The registration happens at page load; without a worker (the dev server) it fails after a wait. */
export async function browserPushManager(): Promise<PushManagerLike> {
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("no_worker")), WORKER_WAIT_MS);
  });
  const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
  return registration.pushManager as unknown as PushManagerLike;
}
