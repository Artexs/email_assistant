import { createPublicKey, verify } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { generateVapidKeyPair } from "../../../platform/vapid-keys";

import { VAPID_EXP_SECONDS, VapidError, vapidHeaders } from "./vapid";

const keyPair = generateVapidKeyPair();
const keys = { ...keyPair, subject: "mailto:ops@example.org" };
const now = new Date("2026-11-18T10:00:00.000Z");
const decodePart = (part: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

function parts(header: string): { t: string; k: string; jwt: string[] } {
  const match = /^vapid t=([^,]+), k=(\S+)$/.exec(header);
  expect(match).not.toBeNull();
  const [, t = "", k = ""] = match ?? [];
  return { t, k, jwt: t.split(".") };
}

describe("vapidHeaders", () => {
  test("3. the JWT verifies with the public key (ES256, ieee-p1363); aud is the origin; exp is now + 43,200 s", () => {
    const { Authorization } = vapidHeaders("https://fcm.googleapis.com/fcm/send/abc", keys, now);
    const { jwt, k } = parts(Authorization);
    expect(k).toBe(keys.publicKey);
    expect(jwt).toHaveLength(3);
    const [head = "", claims = "", signature = ""] = jwt;
    const raw = Buffer.from(keys.publicKey, "base64url");
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33, 65).toString("base64url"),
      },
    });
    const sig = Buffer.from(signature, "base64url");
    expect(sig.length).toBe(64);
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(
      true
    );
    expect(decodePart(head)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(decodePart(claims)).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(now.getTime() / 1000) + 43_200,
      sub: "mailto:ops@example.org",
    });
    expect(VAPID_EXP_SECONDS).toBe(43_200);
  });

  test("3b. a changed claim breaks the signature; a signature of another key does not verify", () => {
    const { Authorization } = vapidHeaders("https://updates.push.services.mozilla.com/wpush/v2/x", keys, now);
    const [head = "", claims = "", signature = ""] = parts(Authorization).jwt;
    const raw = Buffer.from(keys.publicKey, "base64url");
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33, 65).toString("base64url"),
      },
    });
    const forged = Buffer.from(JSON.stringify({ ...decodePart(claims), aud: "https://evil.example" })).toString(
      "base64url"
    );
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${forged}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url")
      )
    ).toBe(false);
  });

  test("4. aud drops the path, the query and the fragment", () => {
    const aud = (endpoint: string): unknown =>
      decodePart(parts(vapidHeaders(endpoint, keys, now).Authorization).jwt[1] ?? "").aud;
    expect(aud("https://web.push.apple.com/x?y=1#z")).toBe("https://web.push.apple.com");
  });

  test("5. a bad key or a bad endpoint is a VapidError with a fixed message and no key text", () => {
    const other = generateVapidKeyPair();
    const cases: [string, typeof keys][] = [
      ["https://fcm.googleapis.com/x", { ...keys, publicKey: other.publicKey }],
      ["https://fcm.googleapis.com/x", { ...keys, privateKey: keys.privateKey.slice(0, 40) }],
      ["https://fcm.googleapis.com/x", { ...keys, privateKey: "not base64url!" }],
      ["not a url", keys],
    ];
    for (const [endpoint, k] of cases) {
      let error: unknown;
      try {
        vapidHeaders(endpoint, k, now);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(VapidError);
      const text = `${(error as Error).message} ${String(error)}`;
      for (const secret of [keys.privateKey, other.privateKey, keys.publicKey, other.publicKey, endpoint])
        expect(text).not.toContain(secret);
    }
  });
});
