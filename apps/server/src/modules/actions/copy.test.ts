import type { DraftCopy } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { FolderMessageMeta } from "../mail";

import { baselineOf, copyOf, draftCopyHash, judgeCopy, type CopyRead } from "./copy";

const base: DraftCopy = {
  text: "Hello Anna,\n\nPlease send the offer.",
  subject: "Offer",
  to: ["anna@example.com"],
  cc: [],
  attachmentCount: 0,
  attachments: [],
};

const found = (copy: DraftCopy): CopyRead => ({ kind: "found", uid: 1, copy });

describe("draftCopyHash", () => {
  test("64 lower-case hex characters, the same for the same copy", () => {
    expect(draftCopyHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(draftCopyHash({ ...base })).toBe(draftCopyHash(base));
  });

  test("a re-encoded copy keeps the hash: line ends, trailing spaces, address case and order", () => {
    const resaved = { ...base, text: "Hello Anna,  \r\n\r\nPlease send the offer.\r\n\r\n", to: ["ANNA@example.com"] };
    expect(draftCopyHash(resaved)).toBe(draftCopyHash(base));
  });

  test.each([
    ["the text", { text: "Hello Anna,\n\nPlease skip the offer." }],
    ["the Subject", { subject: "Another" }],
    ["To", { to: ["piotr@example.com"] }],
    ["Cc", { cc: ["jan@example.com"] }],
    ["an attachment", { attachmentCount: 1, attachments: [{ name: "a.txt", type: "text/plain", size: 3 }] }],
  ] as const)("a change of %s changes the hash", (_, change) => {
    expect(draftCopyHash({ ...base, ...change })).not.toBe(draftCopyHash(base));
  });
});

describe("baselineOf", () => {
  test("the stored hash, or null for no row, no key, or a value that is not 64 hex characters", () => {
    const hash = draftCopyHash(base);
    expect(baselineOf({ uid: 1, copy_hash: hash })).toBe(hash);
    expect(baselineOf(null)).toBeNull();
    expect(baselineOf({ uid: 1 })).toBeNull();
    expect(baselineOf({ copy_hash: "abc" })).toBeNull();
    expect(baselineOf({ copy_hash: hash.toUpperCase() })).toBeNull();
    expect(baselineOf({ copy_hash: 5 })).toBeNull();
  });
});

describe("judgeCopy", () => {
  const hash = draftCopyHash(base);

  test("same, changed, missing and no_baseline", () => {
    expect(judgeCopy(found(base), hash)).toBe("same");
    expect(judgeCopy(found({ ...base, text: "Other" }), hash)).toBe("changed");
    expect(judgeCopy({ kind: "missing" }, hash)).toBe("missing");
    expect(judgeCopy(found(base), null)).toBe("no_baseline");
    // No copy is `missing` before it is `no_baseline`.
    expect(judgeCopy({ kind: "missing" }, null)).toBe("missing");
  });

  test("a copy whose text cannot be read is changed, even when its hash would match", () => {
    const unreadable = { ...base, text: null };
    expect(judgeCopy(found(unreadable), draftCopyHash(unreadable))).toBe("changed");
  });
});

describe("copyOf", () => {
  test("reads Subject, To and Cc from the meta and the text and the attachments from the content", () => {
    const meta = { subject: null, to: ["a@x.test"], cc: ["b@x.test"] } as unknown as FolderMessageMeta;
    const copy = copyOf(meta, {
      text: "t",
      capture: {
        attachmentCount: 2,
        attachments: [{ name: "n", type: "text/plain", size: 4, inline: false }],
      } as never,
    });
    expect(copy).toEqual({
      text: "t",
      subject: "",
      to: ["a@x.test"],
      cc: ["b@x.test"],
      attachmentCount: 2,
      attachments: [{ name: "n", type: "text/plain", size: 4 }],
    });
    expect(copyOf(meta, { text: null, capture: null })).toMatchObject({
      text: null,
      attachmentCount: 0,
      attachments: [],
    });
  });
});
