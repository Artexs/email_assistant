import { describe, expect, test } from "bun:test";

import { claimedSlots, firstSlot, jobHash, pickPortSlot, portBlock } from "./e2e-job-env-args";

describe("port block", () => {
  test("firstSlot and portBlock", () => {
    expect(firstSlot("1ac5ae68")).toBe(856);
    expect(portBlock(856)).toEqual({ app: 28560, telegram: 28561, docs: 28562 });
    expect(portBlock(0)).toEqual({ app: 20000, telegram: 20001, docs: 20002 });
    expect(portBlock(999)).toEqual({ app: 29990, telegram: 29991, docs: 29992 });
  });

  test("a hash that is not 1 to 16 hex characters throws", () => {
    expect(() => firstSlot("xyz")).toThrow();
    expect(() => firstSlot("")).toThrow();
    expect(() => firstSlot("0".repeat(17))).toThrow();
  });
});

describe("pickPortSlot", () => {
  test("starts at the first slot", () => {
    expect(pickPortSlot("1ac5ae68", () => false)).toBe(856);
  });

  test("probes linearly past a taken slot", () => {
    expect(pickPortSlot("1ac5ae68", (slot) => slot === 856)).toBe(857);
  });

  test("wraps after slot 999", () => {
    expect(pickPortSlot("000003e7", (slot) => slot === 999)).toBe(0);
  });

  test("returns null when every slot is taken", () => {
    expect(pickPortSlot("1ac5ae68", () => true)).toBeNull();
  });
});

describe("claimedSlots", () => {
  test("reads only E2E_PORT lines with a port that is a block start", () => {
    const claimed = claimedSlots([
      "A=1\nE2E_PORT=28560\n# E2E_PORT=20000\n",
      "E2E_PORT=8081\n",
      "E2E_PORT=28565\n",
      "E2E_PORT=30000\nE2E_PORT=19990\n",
    ]);
    expect([...claimed]).toEqual([856]);
  });
});

describe("jobHash", () => {
  test("takes the hex tail of a job name", () => {
    expect(jobHash("2026-11-19-1ac5ae68")).toBe("1ac5ae68");
  });

  test("hashes a name with no hex tail, the same on each call", () => {
    const first = jobHash("2026-11-19-odd-name");
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(jobHash("2026-11-19-odd-name")).toBe(first);
    expect(jobHash("2026-11-19-other-name")).not.toBe(first);
  });
});
