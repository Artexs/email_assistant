export {
  countSenderRules,
  getMailboxSettings,
  getMovesSupported,
  insertDefaultSettings,
  insertSenderRule,
  listSenderRules,
  lockSettingsForShare,
  listSenderRuleRows,
  lockMailboxSettings,
  type MailboxSettingsRow,
  type SenderRuleRow,
  updateMailboxSettings,
} from "./repo";
export { addSenderRule, removeSenderRule, type AddRuleResult } from "./rules";
export {
  closedBy,
  getSettingsView,
  setCategoryAuto,
  setMode,
  setToolSwitch,
  SettingsNotFoundError,
  type SettingsChange,
  type SettingsDeps,
  type SettingsView,
} from "./service";
export {
  rulesRoutes,
  settingsRoutes,
  type AutoGateOutcome,
  type RulesRouteDeps,
  type SettingsRouteDeps,
} from "./routes";
export { buildSettingsView, type SettingsViewDeps } from "./view";
