/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "../i18n/en";
import { groupIdFromHash, SETTINGS_GROUPS, type SettingsGroupId } from "./settings-groups";

const settingsDir = join(import.meta.dir, "..", "components", "settings");

// The literal `id="…"` values of the settings components.
function idsInUse(): string[] {
  return readdirSync(settingsDir)
    .filter((file) => file.endsWith(".tsx"))
    .flatMap((file) =>
      Array.from(readFileSync(join(settingsDir, file), "utf8").matchAll(/\bid="([^"]+)"/g), (match) =>
        match.slice(1)
      ).flat()
    );
}

describe("SETTINGS_GROUPS", () => {
  test("the four groups come in page order", () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual(["mailbox", "notices", "organization", "account"]);
  });

  test("a group id is unique and no settings component uses it as an id", () => {
    const ids = SETTINGS_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(idsInUse().filter((id) => ids.some((group) => group === id || `${group}-label` === id))).toEqual([]);
  });

  test("every label is a text key", () => {
    expect(SETTINGS_GROUPS.map((group) => en[group.label])).toEqual([
      "This mailbox",
      "Digests and notices",
      "Organization",
      "Account and security",
    ]);
  });
});

describe("groupIdFromHash", () => {
  test.each<[string, SettingsGroupId | null]>([
    ["#notices", "notices"],
    ["#account", "account"],
    ["#two-factor", null],
    ["#nothing", null],
    ["", null],
  ])("%j gives %j", (hash, id) => {
    expect(groupIdFromHash(hash)).toBe(id);
  });
});
