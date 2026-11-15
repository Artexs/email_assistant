import {
  autoBodySchema,
  barCategories,
  modeBodySchema,
  noGoBodySchema,
  ruleBodySchema,
  ruleListSchema,
  ruleViewSchema,
  rulesQuerySchema,
  settingsChangeSchema,
  settingsViewSchema,
  switchableSyncFolderKeys,
  switchBodySchema,
  syncFolderBodySchema,
  toolSwitchNames,
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
    summary: "Turn a tool switch of a mailbox on or off (owner only).",
    tags: ["settings"],
    params: z.object({ mailboxId, name: z.enum(toolSwitchNames) }),
    body: switchBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound],
  }),
  patchSettingsAuto: apiDoc({
    operationId: "patchSettingsAuto",
    summary: "Turn auto mode of a category on or off. The go/no-go gate can refuse it (owner only).",
    tags: ["settings"],
    params: z.object({ mailboxId, category: z.enum(barCategories) }),
    body: autoBodySchema,
    ok: { status: 200, schema: settingsChangeSchema },
    errors: [ownerOnly, notFound, { status: 409, codes: ["no_go"], schema: noGoBodySchema }],
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
