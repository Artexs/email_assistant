import { pushSubscriptionBodySchema, type PushSubscriptionBody } from "@ea/core/web";
import { beforeEach, describe, expect, test } from "bun:test";

import { pushCardParts } from "./push-card";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  enablePush,
  installHint,
  pushSupported,
  rebindPush,
  subscriptionBody,
  type PermissionState,
  type PushFlowDeps,
  type SubscriptionLike,
} from "./push-client";
import { resetRebindForTest, startRebind } from "./use-rebind-push";

// The browser side of Web Push, with fakes: no browser, no push service, no network.
const PUBLIC_KEY = "BAoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dzj6vH4_wYNFBsiKTA3PkVMU1phaG92fYSLkpmgp661vMM";
const FIXED_BYTES = Uint8Array.from({ length: 65 }, (_unused, index) => (index === 0 ? 4 : (index * 7 + 3) & 255));
const AUTH_BYTES = Uint8Array.from({ length: 16 }, (_unused, index) => (index + 200) & 255);
const AUTH_TEXT = "yMnKy8zNzs_Q0dLT1NXW1w";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/fake-device";

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fakeSubscription(extra: Partial<SubscriptionLike> = {}): SubscriptionLike & { unsubscribed: number } {
  const sub = {
    endpoint: ENDPOINT,
    unsubscribed: 0,
    getKey: (name: "p256dh" | "auth") => arrayBufferOf(name === "p256dh" ? FIXED_BYTES : AUTH_BYTES),
    unsubscribe: () => {
      sub.unsubscribed += 1;
      return Promise.resolve(true);
    },
    ...extra,
  };
  return sub;
}

interface Calls {
  asked: number;
  subscribed: { userVisibleOnly: true; applicationServerKey: Uint8Array }[];
  puts: PushSubscriptionBody[];
}

function fakes(options: {
  permission: PermissionState;
  asked?: PermissionState;
  existing?: SubscriptionLike | null;
  subscribeFails?: boolean;
  putFails?: boolean;
}): { deps: PushFlowDeps; calls: Calls } {
  const calls: Calls = { asked: 0, subscribed: [], puts: [] };
  const deps: PushFlowDeps = {
    permission: () => options.permission,
    requestPermission: () => {
      calls.asked += 1;
      return Promise.resolve(options.asked ?? "granted");
    },
    pushManager: () =>
      Promise.resolve({
        getSubscription: () => Promise.resolve(options.existing ?? null),
        subscribe: (subscribeOptions) => {
          calls.subscribed.push(subscribeOptions);
          return options.subscribeFails === true
            ? Promise.reject(new Error("no"))
            : Promise.resolve(fakeSubscription());
        },
      }),
    put: (body) => {
      calls.puts.push(body);
      return options.putFails === true ? Promise.reject(new Error("no")) : Promise.resolve();
    },
  };
  return { deps, calls };
}

describe("key conversion", () => {
  test("the public key turns into the fixed 65 bytes and back", () => {
    expect([...base64UrlToBytes(PUBLIC_KEY)]).toEqual([...FIXED_BYTES]);
    expect(base64UrlToBytes(PUBLIC_KEY).length).toBe(65);
    expect(bytesToBase64Url(FIXED_BYTES)).toBe(PUBLIC_KEY);
  });

  test("the text of a key is unpadded base64url: no `=`, `+` or `/`; the 65-byte key would carry `=` in standard base64", () => {
    expect(btoa(String.fromCharCode(...FIXED_BYTES)).endsWith("=")).toBe(true);
    expect(bytesToBase64Url(FIXED_BYTES)).not.toContain("=");
    expect(bytesToBase64Url(AUTH_BYTES)).toBe(AUTH_TEXT);
    expect(bytesToBase64Url(arrayBufferOf(AUTH_BYTES))).toBe(AUTH_TEXT);
    expect(AUTH_TEXT).not.toMatch(/[+/=]/);
  });
});

describe("install hint", () => {
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

  test("Android Chrome, iPhone Safari and desktop Firefox", () => {
    expect(installHint(ANDROID, false)).toBe("android");
    expect(installHint(IPHONE, false)).toBe("ios");
    expect(installHint(FIREFOX, false)).toBe("other");
  });

  test("an installed panel needs no help, on any system", () => {
    for (const agent of [ANDROID, IPHONE, FIREFOX]) expect(installHint(agent, true)).toBe("installed");
  });
});

describe("support", () => {
  test("needs Notification, PushManager and a service worker", () => {
    const all = { Notification: {}, PushManager: {}, navigator: { serviceWorker: {} } };
    expect(pushSupported(all)).toBe(true);
    expect(pushSupported({ ...all, Notification: undefined })).toBe(false);
    expect(pushSupported({ ...all, PushManager: undefined })).toBe(false);
    expect(pushSupported({ ...all, navigator: {} })).toBe(false);
  });
});

describe("enablePush", () => {
  test("granted: subscribes with the public key and PUTs unpadded keys that the server schema accepts", async () => {
    const { deps, calls } = fakes({ permission: "granted" });
    expect(await enablePush(PUBLIC_KEY, deps)).toBe("enabled");
    expect(calls.asked).toBe(0);
    expect(calls.subscribed).toHaveLength(1);
    expect(calls.subscribed[0]?.userVisibleOnly).toBe(true);
    expect([...(calls.subscribed[0]?.applicationServerKey ?? [])]).toEqual([...FIXED_BYTES]);
    expect(calls.puts).toEqual([{ endpoint: ENDPOINT, keys: { p256dh: PUBLIC_KEY, auth: AUTH_TEXT } }]);
    expect(calls.puts[0]).not.toHaveProperty("rebindOnly");
    expect(pushSubscriptionBodySchema.safeParse(calls.puts[0]).success).toBe(true);
  });

  test("default permission: asks once, then subscribes", async () => {
    const { deps, calls } = fakes({ permission: "default", asked: "granted" });
    expect(await enablePush(PUBLIC_KEY, deps)).toBe("enabled");
    expect(calls.asked).toBe(1);
    expect(calls.puts).toHaveLength(1);
  });

  test("denied permission: blocked, no question, no subscription and no request", async () => {
    const { deps, calls } = fakes({ permission: "denied" });
    expect(await enablePush(PUBLIC_KEY, deps)).toBe("blocked");
    expect(calls).toEqual({ asked: 0, subscribed: [], puts: [] });
  });

  test("the user refuses the question: blocked, no subscription and no request", async () => {
    for (const answer of ["denied", "default"] as const) {
      const { deps, calls } = fakes({ permission: "default", asked: answer });
      expect(await enablePush(PUBLIC_KEY, deps)).toBe("blocked");
      expect(calls.asked).toBe(1);
      expect(calls.subscribed).toEqual([]);
      expect(calls.puts).toEqual([]);
    }
  });

  test("a failing subscribe or PUT is `failed` and sends nothing more", async () => {
    const subscribe = fakes({ permission: "granted", subscribeFails: true });
    expect(await enablePush(PUBLIC_KEY, subscribe.deps)).toBe("failed");
    expect(subscribe.calls.puts).toEqual([]);
    const put = fakes({ permission: "granted", putFails: true });
    expect(await enablePush(PUBLIC_KEY, put.deps)).toBe("failed");
  });

  test("a subscription of the same key is sent again and not replaced", async () => {
    const existing = fakeSubscription({ options: { applicationServerKey: arrayBufferOf(FIXED_BYTES) } });
    const { deps, calls } = fakes({ permission: "granted", existing });
    expect(await enablePush(PUBLIC_KEY, deps)).toBe("enabled");
    expect(calls.subscribed).toEqual([]);
    expect(existing.unsubscribed).toBe(0);
    expect(calls.puts).toHaveLength(1);
  });

  test("a subscription of an older server key is ended and replaced", async () => {
    const other = Uint8Array.from(FIXED_BYTES, (byte) => byte ^ 1);
    const existing = fakeSubscription({ options: { applicationServerKey: arrayBufferOf(other) } });
    const { deps, calls } = fakes({ permission: "granted", existing });
    expect(await enablePush(PUBLIC_KEY, deps)).toBe("enabled");
    expect(existing.unsubscribed).toBe(1);
    expect(calls.subscribed).toHaveLength(1);
  });

  test("a subscription without keys is not sent", async () => {
    expect(subscriptionBody(fakeSubscription({ getKey: () => null }), false)).toBeNull();
  });
});

describe("rebindPush", () => {
  test("granted and a subscription: one PUT with rebindOnly", async () => {
    const { deps, calls } = fakes({ permission: "granted", existing: fakeSubscription() });
    expect(await rebindPush(deps)).toBe("sent");
    expect(calls.puts).toEqual([
      { endpoint: ENDPOINT, keys: { p256dh: PUBLIC_KEY, auth: AUTH_TEXT }, rebindOnly: true },
    ]);
    expect(pushSubscriptionBodySchema.safeParse(calls.puts[0]).success).toBe(true);
  });

  test("default or denied permission: no PUT, no question, no subscription", async () => {
    for (const permission of ["default", "denied"] as const) {
      const { deps, calls } = fakes({ permission, existing: fakeSubscription() });
      expect(await rebindPush(deps)).toBe("skipped");
      expect(calls).toEqual({ asked: 0, subscribed: [], puts: [] });
    }
  });

  test("no subscription: no PUT, and it never subscribes", async () => {
    const { deps, calls } = fakes({ permission: "granted", existing: null });
    expect(await rebindPush(deps)).toBe("skipped");
    expect(calls).toEqual({ asked: 0, subscribed: [], puts: [] });
  });

  test("a failing PUT (the server answers 404) is silent", async () => {
    const { deps } = fakes({ permission: "granted", existing: fakeSubscription(), putFails: true });
    expect(await rebindPush(deps)).toBe("failed");
  });
});

describe("one re-bind per page load", () => {
  beforeEach(resetRebindForTest);

  test("the second call of the same load does nothing", async () => {
    const { deps, calls } = fakes({ permission: "granted", existing: fakeSubscription() });
    expect(await startRebind(true, true, deps)).toBe("sent");
    expect(startRebind(true, true, deps)).toBeNull();
    expect(calls.puts).toHaveLength(1);
  });

  test("flag off or no browser support: nothing runs, and the load keeps its one try", async () => {
    const { deps, calls } = fakes({ permission: "granted", existing: fakeSubscription() });
    expect(startRebind(false, true, deps)).toBeNull();
    expect(startRebind(true, false, deps)).toBeNull();
    expect(calls.puts).toEqual([]);
    expect(await startRebind(true, true, deps)).toBe("sent");
  });
});

describe("what the card shows", () => {
  const base = {
    vapidPublicKey: PUBLIC_KEY,
    supported: true,
    permission: "default",
    thisDevice: false,
    writable: true,
  } as const;

  test("no server key: the not-set-up text only, no list and no button", () => {
    expect(pushCardParts({ ...base, vapidPublicKey: null })).toEqual({
      notSetUp: true,
      unsupported: false,
      blocked: false,
      canEnable: false,
      canTest: false,
      showDevices: false,
    });
    expect(pushCardParts({ ...base, vapidPublicKey: null, thisDevice: true }).canTest).toBe(false);
  });

  test("a supported browser without a device: the turn-on button, no test button", () => {
    expect(pushCardParts(base)).toMatchObject({ canEnable: true, canTest: false, blocked: false, showDevices: true });
  });

  test("a device of this session: the test button, no turn-on button", () => {
    expect(pushCardParts({ ...base, thisDevice: true, permission: "granted" })).toMatchObject({
      canEnable: false,
      canTest: true,
    });
  });

  test("a blocked permission shows the text and no turn-on button", () => {
    expect(pushCardParts({ ...base, permission: "denied" })).toMatchObject({ blocked: true, canEnable: false });
  });

  test("a browser without push support: the text and no turn-on button", () => {
    expect(pushCardParts({ ...base, supported: false })).toMatchObject({ unsupported: true, canEnable: false });
  });

  test("a read-only organization has neither button", () => {
    expect(pushCardParts({ ...base, writable: false })).toMatchObject({ canEnable: false, canTest: false });
    expect(pushCardParts({ ...base, writable: false, thisDevice: true }).canTest).toBe(false);
  });
});
