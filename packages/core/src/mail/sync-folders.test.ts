import { describe, expect, test } from "bun:test";

import { SORT_FOLDER_NAMES } from "../testmail/delivery";
import { AI_FOLDER_NAMES } from "../triage/planners";

import { AI_FOLDER_ROOT, pickSyncFolders, type SyncFolderDefault } from "./sync-folders";

const listed = (...paths: string[]) => paths.map((path) => ({ path, delimiter: "/" }));
const keys = (picked: SyncFolderDefault[]) => picked.map((folder) => folder.key);

describe("pickSyncFolders", () => {
  test("picks the defaults in the order of the defaults", () => {
    const picked = pickSyncFolders({
      listed: listed("INBOX", "Oferty", "Rachunki", "Społeczności", "Wiadomości-śmieci", "AI", "AI/Spam", "Kosz"),
      reservedPaths: ["Kosz", "AI/Spam"],
    });
    expect(keys(picked)).toEqual(["offers", "social", "bills", "junk"]);
  });

  test("matches the path case-sensitive", () => {
    expect(pickSyncFolders({ listed: listed("oferty"), reservedPaths: [] })).toEqual([]);
  });

  test("skips a reserved path", () => {
    const picked = pickSyncFolders({ listed: listed("Oferty", "Rachunki"), reservedPaths: ["Oferty"] });
    expect(keys(picked)).toEqual(["bills"]);
  });

  test("skips the app's own folders", () => {
    const defaults: SyncFolderDefault[] = [{ key: "offers", path: "AI/Oferty", role: "sort" }];
    expect(pickSyncFolders({ listed: listed("AI/Oferty"), reservedPaths: [], defaults })).toEqual([]);
    expect(
      pickSyncFolders({
        listed: listed("AI"),
        reservedPaths: [],
        defaults: [{ key: "offers", path: "AI", role: "sort" }],
      })
    ).toEqual([]);
    expect(
      pickSyncFolders({
        listed: [{ path: "AI.Oferty", delimiter: "." }],
        reservedPaths: [],
        defaults: [{ key: "offers", path: "AI.Oferty", role: "sort" }],
      })
    ).toEqual([]);
  });

  test("returns nothing for an empty list", () => {
    expect(pickSyncFolders({ listed: [], reservedPaths: [] })).toEqual([]);
  });
});

describe("SORT_FOLDER_NAMES", () => {
  test("comes from the sync defaults", () => {
    expect(SORT_FOLDER_NAMES).toEqual({ offers: "Oferty", social: "Społeczności", bills: "Rachunki" });
  });
});

describe("AI_FOLDER_ROOT", () => {
  test("is the first part of the AI info folder", () => {
    expect(AI_FOLDER_NAMES.ai_info.startsWith(`${AI_FOLDER_ROOT}/`)).toBe(true);
  });
});
