import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxSeedArgs } from "./mailbox-seed-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const base = ["--org-id", ORG, "--mailbox-id", BOX];

describe("parseMailboxSeedArgs", () => {
  test("the ids alone: one mail, no owner, no eval set", () => {
    expect(parseMailboxSeedArgs(base)).toEqual({
      orgId: ORG,
      mailboxId: BOX,
      count: 1,
      evalSet: undefined,
      perCategory: undefined,
      folder: undefined,
      ownerFrom: undefined,
    });
  });

  test("--from-owner numbers from 1 by default; --number-from sets the first number", () => {
    expect(parseMailboxSeedArgs([...base, "--from-owner", "owner@x.test"]).ownerFrom).toEqual({
      address: "owner@x.test",
      numberFrom: 1,
    });
    expect(parseMailboxSeedArgs([...base, "--from-owner", "owner@x.test", "--number-from", "16"]).ownerFrom).toEqual({
      address: "owner@x.test",
      numberFrom: 16,
    });
  });

  test("the bounds of --count are 1 and 1000", () => {
    expect(parseMailboxSeedArgs([...base, "--count", "1000"]).count).toBe(1000);
    expect(() => parseMailboxSeedArgs([...base, "--count", "1001"])).toThrow(UsageError);
    expect(() => parseMailboxSeedArgs([...base, "--count", "0"])).toThrow(UsageError);
  });

  test.each([
    ["a missing --mailbox-id", ["--org-id", ORG]],
    ["an id that is no uuid", ["--org-id", "x", "--mailbox-id", BOX]],
    ["an unknown flag", [...base, "--no-such-flag"]],
    ["a --count that is no number", [...base, "--count", "many"]],
    ["an unknown eval set", [...base, "--eval-cases", "other"]],
    ["--per-category without --eval-cases", [...base, "--per-category", "2"]],
    ["an empty --folder", [...base, "--folder", ""]],
    ["an owner address without @", [...base, "--from-owner", "owner"]],
    ["an owner address without a local part", [...base, "--from-owner", "@x.test"]],
    ["--number-from 0", [...base, "--from-owner", "owner@x.test", "--number-from", "0"]],
    ["--number-from that is no number", [...base, "--from-owner", "owner@x.test", "--number-from", "x"]],
    ["--number-from without --from-owner", [...base, "--number-from", "3"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxSeedArgs(argv)).toThrow(UsageError);
  });
});
