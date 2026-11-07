import { expect, test } from "bun:test";
import type { ImapFlow } from "imapflow";

import { HardError } from "../../../platform/errors";

import {
  cleanupParent,
  createProbeFolder,
  describeFailure,
  sanitizeAlertText,
  type ProbeMoveReport,
} from "./probe-move";

const ALERT = { responseStatus: "NO", serverResponseCode: "ALERT", responseText: "Nested folders\r\n not allowed" };

/** A stub client: a flat server that has no `AI` folder and refuses a folder below it. */
function flatServer() {
  const folders = new Set(["INBOX"]);
  const client = {
    list: async () => [...folders].map((path) => ({ path })),
    mailboxCreate: async (path: string | string[]) => {
      if (Array.isArray(path)) throw ALERT;
      folders.add(path);
      return { path, created: true };
    },
    status: async () => ({ messages: 0 }),
    mailboxDelete: async (path: string) => {
      folders.delete(path);
      return { path };
    },
  };
  return { folders, client: client as unknown as ImapFlow };
}

function newReport(): ProbeMoveReport {
  return {
    namespace: { prefix: "", delimiter: "/" },
    folders: { nested: null, parentCreateOk: null },
    cleanup: { folderDeleted: false, parentFolderCreated: false, parentFolderDeleted: false },
    notes: [],
  } as unknown as ProbeMoveReport;
}

test("createProbeFolder: falls back to a flat folder when the nested path gets a NO ALERT", async () => {
  const { folders, client } = flatServer();
  const report = newReport();
  const ctx = { step: "", cleanupNotes: [] as string[] };
  const { folder, parentFolder } = await createProbeFolder(client, "abcd1234", report, ctx);
  expect(folder).toBe("AI-Probe-abcd1234");
  expect(report.folders.nested).toBe(false);
  expect(report.notes).toEqual([`creating a nested folder under "AI" failed "Nested folders not allowed"`]);
  expect(parentFolder).toBe("AI");
  expect(report.cleanup.parentFolderCreated).toBe(true);

  // The cleanup removes the probe folder and the `AI` folder that the probe created.
  await client.mailboxDelete(folder);
  await cleanupParent(client, report, parentFolder, "/");
  expect(report.cleanup.parentFolderDeleted).toBe(true);
  expect([...folders]).toEqual(["INBOX"]);
});

test("describeFailure: adds the alert text for a NO ALERT error", () => {
  const error = describeFailure(ALERT, "create folder");
  expect(error).toBeInstanceOf(HardError);
  expect(error.message).toContain("at step create folder");
  expect(error.message).toContain("[NO ALERT]");
  expect(error.message).toContain('"Nested folders not allowed"');
});

test("describeFailure: no responseText for an error that is not an ALERT", () => {
  const error = describeFailure(
    { responseStatus: "NO", serverResponseCode: "CANNOT", responseText: "secret mail data" },
    "append to INBOX"
  );
  expect(error.message).toContain("[NO CANNOT]");
  expect(error.message).not.toContain("secret mail data");
});

test("sanitizeAlertText: cuts by code points, not UTF-16 units", () => {
  expect(sanitizeAlertText("😀".repeat(300))).toBe(`"${"😀".repeat(200)}"`);
});
