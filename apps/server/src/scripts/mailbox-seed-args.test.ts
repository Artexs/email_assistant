import { describe, expect, test } from "bun:test";

import { readSeedOptions } from "./mailbox-seed-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const base = ["--org-id", ORG, "--mailbox-id", BOX];

describe("readSeedOptions", () => {
  test("without --from-owner there is no owner and no number", () => {
    expect(readSeedOptions(base)?.ownerFrom).toBeUndefined();
  });

  test("--from-owner numbers from 1 by default; --number-from sets the first number", () => {
    expect(readSeedOptions([...base, "--from-owner", "owner@x.test"])?.ownerFrom).toEqual({
      address: "owner@x.test",
      numberFrom: 1,
    });
    expect(readSeedOptions([...base, "--from-owner", "owner@x.test", "--number-from", "16"])?.ownerFrom).toEqual({
      address: "owner@x.test",
      numberFrom: 16,
    });
  });

  test("an owner address without @, or a bad number, is a usage error", () => {
    expect(readSeedOptions([...base, "--from-owner", "owner"])).toBeUndefined();
    expect(readSeedOptions([...base, "--from-owner", "@x.test"])).toBeUndefined();
    expect(readSeedOptions([...base, "--from-owner", "owner@x.test", "--number-from", "0"])).toBeUndefined();
    expect(readSeedOptions([...base, "--from-owner", "owner@x.test", "--number-from", "x"])).toBeUndefined();
    expect(readSeedOptions([...base, "--number-from", "3"])).toBeUndefined();
  });
});
