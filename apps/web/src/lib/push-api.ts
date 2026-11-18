import {
  pushStateSchema,
  pushSubscriptionAnswerSchema,
  pushTestAnswerSchema,
  type PushState,
  type PushSubscriptionBody,
  type PushTestAnswer,
} from "@ea/core/web";
import { z } from "zod";

import { api } from "./api";
import { browserPushManager, type PermissionState, type PushFlowDeps } from "./push-client";

// The calls of the push device card and of the load-time re-bind (`/api/me/push`). The answers hold no endpoint and no key.
export const loadPushState = (): Promise<PushState> => api("/api/me/push", pushStateSchema);

export const removePushDevice = (id: string): Promise<void> =>
  api(`/api/me/push/devices/${encodeURIComponent(id)}`, z.void(), { method: "DELETE" });

export const sendPushTest = (): Promise<PushTestAnswer> =>
  api("/api/me/push/test", pushTestAnswerSchema, { method: "POST" });

// The real browser: the permission of `Notification`, the push manager of the registered worker and the PUT of the subscription.
export function browserPushDeps(): PushFlowDeps {
  return {
    permission: () => Notification.permission as PermissionState,
    requestPermission: async () => (await Notification.requestPermission()) as PermissionState,
    pushManager: browserPushManager,
    put: async (body: PushSubscriptionBody) => {
      await api("/api/me/push/subscription", pushSubscriptionAnswerSchema, { method: "PUT", body });
    },
  };
}
