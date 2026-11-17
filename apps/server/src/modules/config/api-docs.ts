import {
  autoBodySchema,
  barCategories,
  loopSwitchNames,
  loopWaitBodySchema,
  modeBodySchema,
  noGoBodySchema,
  ruleBodySchema,
  ruleListSchema,
  ruleViewSchema,
  rulesQuerySchema,
  sentSyncBodySchema,
  settingsChangeSchema,
  settingsViewSchema,
  switchableSyncFolderKeys,
  switchBodySchema,
  syncFolderBodySchema,
  toolSwitchNames,
  urgencyBodySchema,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the settings and rules routes (ADR 0023). The schemas are the ones the route and the
// web parse with.
const notFound = { status: 404, codes: ["not_found"] } as const;
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const mailboxId = z.uuid();

export const settingsDocs = {
  getSettings: apiDoc({
    operationId: "getSettings",
    summary: "The settings of one mailbox: mode, tool switches, categories and synced folders.",
    tags: ["settings"],
    params: z.object({ mailboxId }),
    ok: { status: 200, schema: settingsViewSchema },
    errors: [notFound],
  }),
  patchSettingsMode: apiDoc({
    operationId: "patchSettingsMode",
    summary: "Set the mode of a mailbox (owner only).",
    tags: ["settings"],
    params: z.object({ mailboxId }),
    body: modeBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound],
  }),
  patchSettingsSwitch: apiDoc({
    operationId: "patchSettingsSwitch",
    summary:
      "Turn a tool switch of a mailbox on or off (owner only). `auto_follow_up` exists only while the flag `open_loops` is on: else the answer is 404.",
    tags: ["settings"],
    params: z.object({ mailboxId, name: z.enum([...toolSwitchNames, ...loopSwitchNames]) }),
    body: switchBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound],
  }),
  patchSettingsAuto: apiDoc({
    operationId: "patchSettingsAuto",
    summary:
      "Turn auto mode of a category on or off (owner only). The go/no-go gate refuses it with 409 `no_go`; with the flag `trust_ladder` on, `blocks` names the evidence that is missing. `force` sets it anyway.",
    tags: ["settings"],
    params: z.object({ mailboxId, category: z.enum(barCategories) }),
    body: autoBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["no_go"], schema: noGoBodySchema }],
  }),
  putSettingsUrgency: apiDoc({
    operationId: "putSettingsUrgency",
    summary:
      "Set or clear the urgency profile of a mailbox: topics and deadlines (owner only). The answer is the settings.",
    tags: ["settings"],
    params: z.object({ mailboxId }),
    body: urgencyBodySchema,
    ok: { status: 200, schema: settingsViewSchema },
    errors: [ownerOnly, notFound],
  }),
  patchSettingsSyncFolder: apiDoc({
    operationId: "patchSettingsSyncFolder",
    summary: "Turn the sync of a folder of a mailbox on or off (owner only).",
    tags: ["settings"],
    params: z.object({ mailboxId, key: z.enum(switchableSyncFolderKeys) }),
    body: syncFolderBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound],
  }),
  patchSettingsSentSync: apiDoc({
    operationId: "patchSettingsSentSync",
    summary:
      'Turn "Track my sent mail" of a mailbox on or off (owner only). Off deletes the stored sent mail. The answer is 404 while the organization flag is off and the request turns it on.',
    tags: ["settings"],
    params: z.object({ mailboxId }),
    body: sentSyncBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound],
  }),
  patchSettingsLoopWait: apiDoc({
    operationId: "patchSettingsLoopWait",
    summary:
      "Set the wait of the open loops of a mailbox, 1 to 10 working days (owner only). It changes the due date of loops opened later only. The answer is 404 while the flag `open_loops` is off.",
    tags: ["settings"],
    params: z.object({ mailboxId }),
    body: loopWaitBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound],
  }),
};

export const rulesDocs = {
  getRules: apiDoc({
    operationId: "getRules",
    summary: "The sender rules of the organization, and of one mailbox when `mailboxId` is set.",
    tags: ["rules"],
    query: rulesQuerySchema,
    ok: { status: 200, schema: ruleListSchema },
  }),
  postRule: apiDoc({
    operationId: "postRule",
    summary: "Add a sender rule (owner only).",
    tags: ["rules"],
    body: ruleBodySchema,
    ok: { status: 201, schema: ruleViewSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["rule_exists", "rule_limit"] }],
  }),
  deleteRule: apiDoc({
    operationId: "deleteRule",
    summary: "Remove a sender rule (owner only).",
    tags: ["rules"],
    params: z.object({ id: z.uuid() }),
    ok: { status: 204 },
    errors: [ownerOnly, notFound],
  }),
};
