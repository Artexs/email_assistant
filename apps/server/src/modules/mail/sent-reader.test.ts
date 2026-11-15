import { describe, expect, test } from "bun:test";

import { createFakeMailProvider } from "./fake";
import type { SentFolderReader } from "./port";

// Type test: `bun run typecheck` checks the `@ts-expect-error` lines. A write method must not exist on the reader.
function writesAreTypeErrors(reader: SentFolderReader): void {
  // @ts-expect-error moveMessage is not a read method
  void reader.moveMessage;
  // @ts-expect-error transferByAppend is not a read method
  void reader.transferByAppend;
  // @ts-expect-error deleteMessage is not a read method
  void reader.deleteMessage;
  // @ts-expect-error setFlags is not a read method
  void reader.setFlags;
  // @ts-expect-error appendMessage is not a read method
  void reader.appendMessage;
  // @ts-expect-error ensureFolder is not a read method
  void reader.ensureFolder;
}

describe("SentFolderReader", () => {
  test("a fake mail provider is a reader, and the reader has the five read methods", async () => {
    const reader: SentFolderReader = createFakeMailProvider();
    expect(typeof writesAreTypeErrors).toBe("function");
    expect(await reader.searchSinceIn("Sent", new Date(0))).toEqual([]);
  });
});
