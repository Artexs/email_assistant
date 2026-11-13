import { noticeKinds, noticeRenderers } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { detectors, queuedBy } from "./index";

// A new notice kind needs a renderer (core), and a detector or a `queuedBy` entry (here).
describe("notice completeness", () => {
  const producedKinds = [...detectors.flatMap((detector) => detector.kinds), ...Object.keys(queuedBy)];

  test("no kind has two producers", () => {
    const repeated = producedKinds.filter((kind, index) => producedKinds.indexOf(kind) !== index);
    expect(repeated).toEqual([]);
  });

  test("detectors and queuedBy together cover every notice kind", () => {
    expect([...producedKinds].sort()).toEqual([...noticeKinds].sort());
  });

  test("every notice kind has a renderer", () => {
    expect(Object.keys(noticeRenderers).sort()).toEqual([...noticeKinds].sort());
  });

  test("detector names are unique", () => {
    const names = detectors.map((detector) => detector.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
