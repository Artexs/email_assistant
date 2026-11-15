import { describe, expect, test } from "bun:test";

import type { ChangelogRelease } from "@ea/core";

import { readSeen, WHATS_NEW_MAX, whatsNew, whatsNewKey, writeSeen } from "./whats-new";

function release(version: string, items = 1): ChangelogRelease {
  return {
    version,
    date: version === "Unreleased" ? null : "2026-01-01",
    forUsers: Array.from({ length: items }, (_, index) => ({ en: `en ${version} ${index}`, pl: `pl ${version} ${index}` })),
  };
}

const versions = (releases: ChangelogRelease[]) => releases.map((entry) => entry.version);

describe("whatsNew", () => {
  test("T1: no stored version shows the newest release only", () => {
    const result = whatsNew([release("0.2.0"), release("0.1.0")], null);
    expect(versions(result.show)).toEqual(["0.2.0"]);
    expect(result.newest).toBe("0.2.0");
  });

  test("T2: an older stored version shows the newer release", () => {
    expect(versions(whatsNew([release("0.2.0"), release("0.1.0")], "0.1.0").show)).toEqual(["0.2.0"]);
  });

  test("T3: every newer release shows, newest first", () => {
    const result = whatsNew([release("0.3.0"), release("0.2.0"), release("0.1.0")], "0.1.0");
    expect(versions(result.show)).toEqual(["0.3.0", "0.2.0"]);
    expect(result.newest).toBe("0.3.0");
  });

  test("T4: the newest or a newer stored version shows nothing", () => {
    const releases = [release("0.2.0"), release("0.1.0")];
    expect(whatsNew(releases, "0.2.0").show).toEqual([]);
    expect(whatsNew(releases, "0.9.0")).toEqual({ show: [], newest: "0.2.0" });
  });

  test("T4b: the stored version compares as numbers, not as text", () => {
    const releases = [release("0.10.0"), release("0.9.0")];
    expect(versions(whatsNew(releases, "0.9.0").show)).toEqual(["0.10.0"]);
    expect(whatsNew(releases, "0.10.0").show).toEqual([]);
    expect(whatsNew([release("0.2.0")], "0.10.0").show).toEqual([]);
  });

  test("T5: a stored value that is not SemVer counts as no stored version", () => {
    const releases = [release("0.3.0"), release("0.2.0"), release("0.1.0")];
    for (const stored of ["garbage", "", "1.2", "01.2.3", "0.2.0-rc.1", "0.1.0+build", " 0.1.0", "v0.1.0"]) {
      expect(versions(whatsNew(releases, stored).show)).toEqual(["0.3.0"]);
    }
  });

  test("T6: only Unreleased shows nothing and has no newest", () => {
    expect(whatsNew([release("Unreleased")], null)).toEqual({ show: [], newest: null });
    expect(whatsNew([], null)).toEqual({ show: [], newest: null });
    expect(whatsNew([release("Unreleased")], "0.1.0")).toEqual({ show: [], newest: null });
  });

  test("T6b: Unreleased never shows beside released versions and never sets newest", () => {
    const releases = [release("Unreleased"), release("0.2.0"), release("0.1.0")];
    expect(whatsNew(releases, null)).toEqual({ show: [release("0.2.0")], newest: "0.2.0" });
    expect(versions(whatsNew(releases, "0.1.0").show)).toEqual(["0.2.0"]);
  });

  test("a release whose version is not x.y.z is ignored, not an error", () => {
    const releases = [release("garbage"), release("0.2.0"), release("0.1.0")];
    expect(whatsNew(releases, null)).toEqual({ show: [release("0.2.0")], newest: "0.2.0" });
    expect(whatsNew([release("garbage")], null)).toEqual({ show: [], newest: null });
  });

  test("T7: a release without items never shows, but it is the newest", () => {
    const result = whatsNew([release("0.2.0", 0), release("0.1.0")], "0.1.0");
    expect(result).toEqual({ show: [], newest: "0.2.0" });
  });

  test("T7b: a release without items is skipped among others, also with no stored version", () => {
    const releases = [release("0.3.0"), release("0.2.0", 0), release("0.1.0")];
    expect(versions(whatsNew(releases, "0.1.0").show)).toEqual(["0.3.0"]);
    expect(whatsNew([release("0.2.0", 0), release("0.1.0")], null)).toEqual({ show: [], newest: "0.2.0" });
  });

  test("T8: seven newer releases show five, newest first", () => {
    const releases = ["0.8.0", "0.7.0", "0.6.0", "0.5.0", "0.4.0", "0.3.0", "0.2.0", "0.1.0"].map((version) => release(version));
    const result = whatsNew(releases, "0.1.0");
    expect(WHATS_NEW_MAX).toBe(5);
    expect(versions(result.show)).toEqual(["0.8.0", "0.7.0", "0.6.0", "0.5.0", "0.4.0"]);
    expect(result.newest).toBe("0.8.0");
  });

  test("T8b: the five are counted after releases without items are dropped", () => {
    const releases = [
      release("0.8.0", 0),
      ...["0.7.0", "0.6.0", "0.5.0", "0.4.0", "0.3.0", "0.2.0"].map((version) => release(version)),
      release("0.1.0"),
    ];
    expect(versions(whatsNew(releases, "0.1.0").show)).toEqual(["0.7.0", "0.6.0", "0.5.0", "0.4.0", "0.3.0"]);
  });

  test("T8c: the order of the input does not matter", () => {
    const result = whatsNew([release("0.1.0"), release("0.3.0"), release("0.2.0")], "0.1.0");
    expect(versions(result.show)).toEqual(["0.3.0", "0.2.0"]);
    expect(result.newest).toBe("0.3.0");
  });

  test("a shown release keeps its lines", () => {
    const result = whatsNew([release("0.2.0", 2)], null);
    expect(result.show[0]?.forUsers).toEqual([
      { en: "en 0.2.0 0", pl: "pl 0.2.0 0" },
      { en: "en 0.2.0 1", pl: "pl 0.2.0 1" },
    ]);
  });
});

describe("seen storage", () => {
  function memory(): { store: Map<string, string>; storage: Pick<Storage, "getItem" | "setItem"> } {
    const store = new Map<string, string>();
    return {
      store,
      storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => void store.set(key, value) },
    };
  }

  const broken: Pick<Storage, "getItem" | "setItem"> = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };

  test("T9: the key holds the member id", () => {
    expect(whatsNewKey("u1")).toBe("ea.whatsNewSeen:u1");
  });

  test("T9: a storage that throws gives unavailable and false", () => {
    expect(readSeen(broken, "u1")).toBe("unavailable");
    expect(writeSeen(broken, "u1", "0.2.0")).toBe(false);
  });

  test("T9b: write then read gives the version; two members keep their own", () => {
    const { store, storage } = memory();
    expect(readSeen(storage, "u1")).toBeNull();
    expect(writeSeen(storage, "u1", "0.2.0")).toBe(true);
    expect(store.get("ea.whatsNewSeen:u1")).toBe("0.2.0");
    expect(readSeen(storage, "u1")).toBe("0.2.0");
    expect(readSeen(storage, "u2")).toBeNull();
    expect(writeSeen(storage, "u2", "0.1.0")).toBe(true);
    expect(readSeen(storage, "u1")).toBe("0.2.0");
    expect(readSeen(storage, "u2")).toBe("0.1.0");
  });

  test("T9c: a read error does not stop a later write, and the reverse", () => {
    const readOnly = { getItem: () => "0.1.0", setItem: broken.setItem };
    expect(readSeen(readOnly, "u1")).toBe("0.1.0");
    expect(writeSeen(readOnly, "u1", "0.2.0")).toBe(false);
    const writeOnly = { getItem: broken.getItem, setItem: () => undefined };
    expect(readSeen(writeOnly, "u1")).toBe("unavailable");
    expect(writeSeen(writeOnly, "u1", "0.2.0")).toBe(true);
  });
});
