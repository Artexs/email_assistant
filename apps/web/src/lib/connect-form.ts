import { MAIL_PRESETS, presetForAddress, type PresetKey } from "@ea/core/web";

import type { TextKey } from "../i18n/en";

export type ProviderChoice = PresetKey | "other";

export interface ConnectFormState {
  provider: ProviderChoice;
  providerTouched: boolean;
  address: string;
  password: string;
  appPassword: boolean;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
}

const appPasswordFor = (provider: ProviderChoice) =>
  provider !== "other" && MAIL_PRESETS[provider].secretKind === "app_password";

export function initialConnectForm(): ConnectFormState {
  return {
    provider: "interia",
    providerTouched: false,
    address: "",
    password: "",
    appPassword: false,
    imapHost: "",
    imapPort: "993",
    smtpHost: "",
    smtpPort: "465",
  };
}

export function onAddressChange(state: ConnectFormState, address: string): ConnectFormState {
  if (state.providerTouched) return { ...state, address };
  const preset = presetForAddress(address);
  if (preset === null) return { ...state, address };
  return { ...state, address, provider: preset, appPassword: appPasswordFor(preset) };
}

export function onProviderChange(state: ConnectFormState, provider: ProviderChoice): ConnectFormState {
  return { ...state, provider, providerTouched: true, appPassword: appPasswordFor(provider) };
}

export function toConnectBody(state: ConnectFormState): unknown {
  const secretKind = state.appPassword ? "app_password" : "password";
  const address = state.address.trim();
  if (state.provider !== "other") return { address, password: state.password, secretKind, preset: state.provider };
  return {
    address,
    password: state.password,
    secretKind,
    imapHost: state.imapHost.trim(),
    imapPort: Number(state.imapPort.trim() === "" ? Number.NaN : state.imapPort.trim()),
    smtpHost: state.smtpHost.trim(),
    smtpPort: Number(state.smtpPort.trim() === "" ? Number.NaN : state.smtpPort.trim()),
  };
}

const fieldNames: readonly (keyof ConnectFormState)[] = [
  "address",
  "password",
  "imapHost",
  "imapPort",
  "smtpHost",
  "smtpPort",
];

export function fieldErrorKeys(
  issues: { path: PropertyKey[] | string; message: string; code?: string }[]
): Partial<Record<keyof ConnectFormState, TextKey>> {
  const result: Partial<Record<keyof ConnectFormState, TextKey>> = {};
  for (const issue of issues) {
    // A server detail has a dotted path string; a schema issue has an array.
    const head = Array.isArray(issue.path) ? String(issue.path[0]) : String(issue.path).split(".")[0];
    const field = fieldNames.find((name) => name === head);
    if (field === undefined || result[field] !== undefined) continue;
    const isPort = field === "imapPort" || field === "smtpPort";
    const required = issue.message === "required" || (issue.code === "too_small" && !isPort);
    if (required) result[field] = "err_required";
    else if (isPort) result[field] = "err_port";
    else if (field === "imapHost" || field === "smtpHost") result[field] = "err_host";
    else if (field === "address") result[field] = "email_invalid";
    else result[field] = "err_required";
  }
  return result;
}
