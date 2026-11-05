import { describe, expect, test } from "bun:test";

import { splitAddress } from "./address";

describe("splitAddress", () => {
  test("splits a display name and an address", () => {
    expect(splitAddress("Łukasz Nowak <lukasz@firma.test>")).toEqual({
      name: "Łukasz Nowak",
      address: "lukasz@firma.test",
    });
  });

  test("removes double quotes around the name", () => {
    expect(splitAddress('"Nowak, Jan" <jan@firma.test>')).toEqual({ name: "Nowak, Jan", address: "jan@firma.test" });
  });

  test("a bare address has no name", () => {
    expect(splitAddress("anna@firma.test")).toEqual({ name: null, address: "anna@firma.test" });
  });

  test("an empty name gives null", () => {
    expect(splitAddress(" <a@x.test> ")).toEqual({ name: null, address: "a@x.test" });
  });

  test("keeps the case of the address", () => {
    expect(splitAddress("Anna <Anna@Firma.TEST>").address).toBe("Anna@Firma.TEST");
  });
});
