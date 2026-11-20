import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { afterAll, expect, test } from "bun:test";

import { completeCorpus, createMiniCorpus, removeAllCorpora } from "./sim-fixtures.test-helper";
import { completeSentCorpus, createSentCorpus, removeAllSentCorpora } from "./sim-sent-fixtures.test-helper";

// Run by `tmp-leak.test.ts` in a child `bun test` with its own TMPDIR; it is not a test of the unit lane.
// It makes corpora the way the callers do, one of them replaced before its cleanup, then leaves the rest to the hooks.
afterAll(removeAllCorpora);
afterAll(removeAllSentCorpora);

test("makes folders and keeps two of them for the afterAll hooks", async () => {
  const kept = await createMiniCorpus({ plan: true });
  await completeCorpus();
  await completeCorpus();
  await createSentCorpus({ plan: true });
  await completeSentCorpus();
  await completeSentCorpus();
  kept.cleanup();
  // template and copy of each kind, a second copy of each kind, and the sent corpus: five folders at least stay.
  expect(readdirSync(tmpdir()).length).toBeGreaterThanOrEqual(5);
});
