import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ActiveWhen, type Subprocessor, subprocessors } from "@ea/core/web";

import {
  DEFAULT_LLM_PROVIDER,
  NOT_CONFIRMED,
  publicSubprocessors,
  subprocessorView,
  usedWhenView,
} from "./subprocessor-view";

const row = (over: Partial<Subprocessor> = {}): Subprocessor => ({
  id: "x",
  name: "Example",
  purpose: { en: "A purpose", pl: "Cel" },
  dataReceived: { en: "Some data", pl: "Jakieś dane" },
  location: { en: "Poland", pl: "Polska" },
  termsUrl: "https://example.test/privacy",
  personalData: true,
  activeWhen: { kind: "always" },
  ...over,
});

describe("subprocessorView", () => {
  test("T4 a placeholder field is shown as not confirmed yet, in both languages; a placeholder terms URL is null", () => {
    const placeholder = row({
      location: { en: "<to confirm: country>", pl: "<to confirm: country>" },
      termsUrl: "<to confirm: SMTP provider privacy page>",
    });
    expect(subprocessorView(placeholder, "en").location).toBe("Not confirmed yet");
    expect(subprocessorView(placeholder, "pl").location).toBe("Jeszcze niepotwierdzone");
    expect(subprocessorView(placeholder, "en").termsUrl).toBeNull();
  });

  test("T4 a field with a placeholder beside real text, and a placeholder name, are shown as not confirmed yet", () => {
    const mixed = row({
      name: "<SMTP provider>",
      location: { en: "No EU region. <to confirm: country>", pl: "x <y>" },
    });
    const view = subprocessorView(mixed, "en");
    expect(view.name).toBe(NOT_CONFIRMED.en);
    expect(view.location).toBe(NOT_CONFIRMED.en);
  });

  test("T4 a clean row is unchanged", () => {
    expect(subprocessorView(row(), "pl")).toEqual({
      id: "x",
      name: "Example",
      purpose: "Cel",
      dataReceived: "Jakieś dane",
      location: "Polska",
      termsUrl: "https://example.test/privacy",
      usedWhen: "Zawsze",
    });
  });

  test("T4 each kind of activeWhen gives its text, and an env row does not print its key", () => {
    const kinds: ActiveWhen[] = [
      { kind: "always" },
      { kind: "llmProvider", provider: "openai" },
      { kind: "env", key: "SOME_SECRET_KEY_NAME" },
      { kind: "env", key: "ANOTHER_KEY", unless: "off" },
      { kind: "host", part: "backup" },
    ];
    expect(kinds.map((when) => usedWhenView(when, "en"))).toEqual([
      "Always",
      "When the install uses this AI provider",
      "When the operator sets up this service",
      "Unless the operator turns this service off",
      "When the server makes backups",
    ]);
    for (const lang of ["en", "pl"] as const) {
      const texts = kinds.map((when) => usedWhenView(when, lang));
      expect(new Set(texts).size).toBe(kinds.length);
      for (const text of texts) expect(text).not.toMatch(/SOME_SECRET_KEY_NAME|ANOTHER_KEY|[A-Z]{2,}_[A-Z]/);
    }
  });

  test("the real registry: no view holds an angle bracket or an env key, and every row has a text in both languages", () => {
    for (const lang of ["en", "pl"] as const) {
      for (const source of subprocessors) {
        const view = subprocessorView(source, lang);
        for (const text of [view.name, view.purpose, view.dataReceived, view.location, view.usedWhen]) {
          expect(text).not.toMatch(/[<>]/);
          expect(text).not.toBe("");
        }
        if (source.activeWhen.kind === "env") expect(view.usedWhen).not.toContain(source.activeWhen.key);
        if (view.termsUrl !== null) expect(view.termsUrl).toMatch(/^https:\/\//);
      }
    }
  });
});

describe("publicSubprocessors", () => {
  test("an AI provider other than the default is not on the page; every other row is", () => {
    const optional = row({ id: "other-ai", activeWhen: { kind: "llmProvider", provider: "other" } });
    const standard = row({ id: "std-ai", activeWhen: { kind: "llmProvider", provider: DEFAULT_LLM_PROVIDER } });
    const plain = row({ id: "plain" });
    expect(publicSubprocessors([optional, standard, plain]).map((entry) => entry.id)).toEqual(["std-ai", "plain"]);
  });

  test("the real registry: the default provider row stays, no other AI provider row stays", () => {
    const shown = publicSubprocessors(subprocessors);
    const providerRows = shown.filter((entry) => entry.activeWhen.kind === "llmProvider");
    expect(providerRows.map((entry) => entry.id)).toEqual([DEFAULT_LLM_PROVIDER]);
    expect(shown.length).toBe(subprocessors.filter((entry) => entry.activeWhen.kind !== "llmProvider").length + 1);
  });

  test("the default provider is the one that the server config runs without a key", () => {
    const registry = readFileSync(join(import.meta.dir, "../../../server/src/platform/llm/providers/index.ts"), "utf8");
    expect(registry).toContain(`defaultLlmProviderId: LlmProviderId = "${DEFAULT_LLM_PROVIDER}"`);
    const config = readFileSync(join(import.meta.dir, "../../../server/src/platform/config-llm.ts"), "utf8");
    expect(config).toContain("z.enum(llmProviderIds).default(defaultLlmProviderId)");
  });
});
