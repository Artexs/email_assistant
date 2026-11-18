import type { PermissionState } from "./push-client";

// What the push device card shows. One pure function, so a unit test covers every combination without a browser.
export interface PushCardFacts {
  /** The public VAPID key from the server; null while the server has no keys. */
  vapidPublicKey: string | null;
  /** The browser has `Notification`, `PushManager` and a service worker. */
  supported: boolean;
  permission: PermissionState;
  /** A device of this session is in the list. */
  thisDevice: boolean;
  /** `canWrite(me)`: a suspended organization takes no write. */
  writable: boolean;
}

export interface PushCardParts {
  /** The server has no keys: one text, no list, no button. */
  notSetUp: boolean;
  unsupported: boolean;
  blocked: boolean;
  canEnable: boolean;
  canTest: boolean;
  showDevices: boolean;
}

export function pushCardParts(facts: PushCardFacts): PushCardParts {
  const keyed = facts.vapidPublicKey !== null;
  const blocked = keyed && facts.supported && facts.permission === "denied";
  return {
    notSetUp: !keyed,
    unsupported: keyed && !facts.supported,
    blocked,
    canEnable: keyed && facts.supported && !blocked && !facts.thisDevice && facts.writable,
    canTest: keyed && facts.thisDevice && facts.writable,
    showDevices: keyed,
  };
}
