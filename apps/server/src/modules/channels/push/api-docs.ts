import {
  pushStateSchema,
  pushSubscriptionAnswerSchema,
  pushSubscriptionBodySchema,
  pushTestAnswerSchema,
} from "@ea/core";
import { z } from "zod";

import { apiDoc } from "../../../platform/openapi";

// The OpenAPI description of the push device routes (ADR 0023). Every route is for any member and works on the own user only.
// With the flag `web_push` off every route answers 404 `not_found`.
const tags = ["push"];
const flagOff = { status: 404, codes: ["not_found"] } as const;

export const pushDocs = {
  getPush: apiDoc({
    operationId: "getPush",
    summary:
      "The VAPID public key (null while the server has no keys) and the live push devices of the own user: label, times and whether the device belongs to this session. No endpoint, no key.",
    tags,
    ok: { status: 200, schema: pushStateSchema },
    errors: [flagOff],
  }),
  putPushSubscription: apiDoc({
    operationId: "putPushSubscription",
    summary:
      "Register the push subscription of this browser, or re-bind it to this session. The endpoint must be an https address of a known push service (400 `push_host_not_allowed`). With `rebindOnly` a device that the user does not have answers 404 `no_device` and nothing is stored.",
    tags,
    body: pushSubscriptionBodySchema,
    ok: { status: 200, schema: pushSubscriptionAnswerSchema },
    errors: [
      { status: 400, codes: ["push_host_not_allowed"] },
      { status: 404, codes: ["not_found", "no_device"] },
      { status: 409, codes: ["push_off", "push_device_elsewhere"] },
    ],
  }),
  deletePushDevice: apiDoc({
    operationId: "deletePushDevice",
    summary: "Remove a push device of the own user. The id of another user or organization answers 404.",
    tags,
    params: z.object({ id: z.uuid() }),
    ok: { status: 204 },
    errors: [flagOff],
  }),
  postPushTest: apiDoc({
    operationId: "postPushTest",
    summary:
      "Send one test notice to the devices of this session. A device that the push service reports as gone is removed. At most 5 a user an hour (429 `push_test_limit`).",
    tags,
    ok: { status: 200, schema: pushTestAnswerSchema },
    errors: [flagOff, { status: 409, codes: ["push_off"] }, { status: 429, codes: ["push_test_limit"] }],
  }),
};
