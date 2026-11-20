// What the security page shows of one row of the sub-processor registry (`subprocessors` in `@ea/core/web`).
// The legal pages of the panel show raw placeholders and the name of a config key (`usedWhenText`); a public page does neither.
import type { ActiveWhen, Subprocessor, UserLocale } from "@ea/core/web";

export const NOT_CONFIRMED: Readonly<Record<UserLocale, string>> = {
  en: "Not confirmed yet",
  pl: "Jeszcze niepotwierdzone",
};

// The AI provider that the config runs when no key chooses one (`LLM_PROVIDER` in `platform/config-llm.ts`; a test ties the two).
// The page names only the services that run by default (owner decision 2026-11-20): another AI provider is an option of the
// install, and its registry row stays out of the page.
export const DEFAULT_LLM_PROVIDER = "openai";

export interface SubprocessorView {
  id: string;
  name: string;
  purpose: string;
  dataReceived: string;
  location: string;
  // The provider's privacy page, or null while the registry holds a placeholder.
  termsUrl: string | null;
  usedWhen: string;
}

const PLACEHOLDER = /<[^>]*>/;

// A field with a `<…>` placeholder is shown as "not confirmed yet", also when real text stands beside the placeholder:
// the real text of such a field is a fact that no ledger row proves.
function field(text: string, lang: UserLocale): string {
  return PLACEHOLDER.test(text) ? NOT_CONFIRMED[lang] : text;
}

const USED_WHEN: Readonly<Record<ActiveWhen["kind"] | "envUnless", Readonly<Record<UserLocale, string>>>> = {
  always: { en: "Always", pl: "Zawsze" },
  env: { en: "When the operator sets up this service", pl: "Gdy operator konfiguruje tę usługę" },
  envUnless: { en: "Unless the operator turns this service off", pl: "Chyba że operator wyłączy tę usługę" },
  llmProvider: { en: "When the install uses this AI provider", pl: "Gdy instalacja używa tego dostawcy AI" },
  host: { en: "When the server makes backups", pl: "Gdy serwer wykonuje kopie zapasowe" },
};

// The text of a condition in plain words. It never prints the name of a config key.
export function usedWhenView(when: ActiveWhen, lang: UserLocale): string {
  if (when.kind === "env" && when.unless !== undefined) return USED_WHEN.envUnless[lang];
  return USED_WHEN[when.kind][lang];
}

export function subprocessorView(row: Subprocessor, lang: UserLocale): SubprocessorView {
  return {
    id: row.id,
    name: field(row.name, lang),
    purpose: field(row.purpose[lang], lang),
    dataReceived: field(row.dataReceived[lang], lang),
    location: field(row.location[lang], lang),
    termsUrl: /^https:\/\//.test(row.termsUrl) && !PLACEHOLDER.test(row.termsUrl) ? row.termsUrl : null,
    usedWhen: usedWhenView(row.activeWhen, lang),
  };
}

// The rows of the page: every registry row except an AI provider that is not the default one.
export function publicSubprocessors(rows: readonly Subprocessor[]): Subprocessor[] {
  return rows.filter(
    (row) => row.activeWhen.kind !== "llmProvider" || row.activeWhen.provider === DEFAULT_LLM_PROVIDER
  );
}
