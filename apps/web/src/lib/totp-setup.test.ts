import { describe, expect, test } from "bun:test";
import { encode } from "uqr";

import { groupSecret, qrPath, totpSecretOf } from "./totp-setup";

const LONG_URI =
  "otpauth://totp/Email%20Assistant:owner%40x.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP12345&issuer=Email%20Assistant&digits=6&period=30";

interface Rect {
  x: number;
  y: number;
  n: number;
}

function rectsOf(d: string): Rect[] {
  return [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)].map((m) => {
    expect(m[3]).toBe(m[4]);
    return { x: Number(m[1]), y: Number(m[2]), n: Number(m[3]) };
  });
}

describe("totpSecretOf", () => {
  test("reads the secret of a TOTP URI and refuses anything else", () => {
    expect(
      totpSecretOf(
        "otpauth://totp/Email%20Assistant:a%40x.test?secret=JBSWY3DPEHPK3PXP&issuer=Email%20Assistant&digits=6&period=30"
      )
    ).toBe("JBSWY3DPEHPK3PXP");
    for (const bad of [
      "https://x.test/?secret=JBSW",
      "otpauth://hotp/A?secret=JBSW",
      "otpauth://totp/A",
      "otpauth://totp/A?secret=jbsw!!",
      "not a url",
    ]) {
      expect(totpSecretOf(bad)).toBeNull();
    }
  });
});

describe("groupSecret", () => {
  test("groups by 4 with one space", () => {
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupSecret("")).toBe("");
  });
});

describe("qrPath", () => {
  test("draws the 152-character URI at size 53, inside the box and stable", () => {
    expect(LONG_URI).toHaveLength(152);
    const { size, d } = qrPath(LONG_URI);
    expect(size).toBe(53);
    expect(d.startsWith("M")).toBe(true);
    const rects = rectsOf(d);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.n).toBeGreaterThan(0);
      expect(r.x + r.n).toBeLessThanOrEqual(size);
      expect(r.y + 1).toBeLessThanOrEqual(size);
    }
    expect(qrPath(LONG_URI).d).toBe(d);
  });

  test("draws exactly the dark cells of the encoder", () => {
    const { d } = qrPath(LONG_URI);
    const drawn = rectsOf(d).reduce((sum, r) => sum + r.n, 0);
    const dark = encode(LONG_URI, { ecc: "M", border: 2 })
      .data.flat()
      .filter((cell) => cell).length;
    expect(drawn).toBe(dark);
  });
});
