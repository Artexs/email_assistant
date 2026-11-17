import { describe, expect, test } from "bun:test";

import { HISTORY_SAMPLE_SIZE, orderSample } from "./history-classify";

const candidate = (n: number, hash: string) => ({ id: `id-${String(n).padStart(4, "0")}`, hash });

describe("orderSample", () => {
  test("acted-on mail first in the given (newest first) order, then the fill by hash", () => {
    const candidates = [candidate(1, "d"), candidate(2, "a"), candidate(3, "c"), candidate(4, "b"), candidate(5, "e")];
    const acted = new Set(["id-0003", "id-0001"]);
    expect(orderSample(candidates, acted)).toEqual(["id-0001", "id-0003", "id-0002", "id-0004", "id-0005"]);
  });

  test("the hash ties break by id", () => {
    expect(orderSample([candidate(2, "x"), candidate(1, "x")], new Set())).toEqual(["id-0001", "id-0002"]);
  });

  test("the sample is cut at 500 and the acted-on mail is never cut for a fill mail", () => {
    const candidates = Array.from({ length: 700 }, (_, n) => candidate(n, String(n).padStart(4, "0")));
    const acted = new Set(candidates.slice(600, 650).map((c) => c.id));
    const sample = orderSample(candidates, acted);
    expect(sample).toHaveLength(HISTORY_SAMPLE_SIZE);
    for (const id of acted) expect(sample).toContain(id);
  });
});
