import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { decryptPushBody, newReceiver } from "../../../../test/push-decrypt";

import {
  type EncryptDeps,
  encryptPushPayload,
  MAX_PLAINTEXT_BYTES,
  PushKeyError,
  PushPayloadTooLarge,
} from "./encrypt";

const b64 = (value: string): Buffer => Buffer.from(value.replace(/\s+/g, ""), "base64url");

// RFC 8291 Section 5 and Appendix A (text fetched from rfc-editor.org on 2026-11-18; whitespace removed).
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
         mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
         pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
};

describe("encryptPushPayload", () => {
  test("1. the RFC 8291 example gives exactly the body of the RFC", () => {
    const body = encryptPushPayload({ p256dh: rfc.uaPublic, auth: rfc.auth }, Buffer.from(rfc.plaintext), {
      ephemeral: { privateKey: b64(rfc.asPrivate), publicKey: b64(rfc.asPublic) },
      salt: b64(rfc.salt),
    });
    expect(Buffer.from(body).toString("base64url")).toBe(rfc.body.replace(/\s+/g, ""));
    // 86 header + 41 plaintext + 1 delimiter + 16 tag. (The RFC example shows `Content-Length: 145`; its 192 base64 characters are 144 bytes.)
    expect(body.length).toBe(144);
  });

  test("1b. the test-side decrypt opens the RFC body (the decrypt is checked against the RFC, not only against our encrypt)", () => {
    const plain = decryptPushBody(b64(rfc.body), {
      privateKey: b64(rfc.uaPrivate),
      publicKey: b64(rfc.uaPublic),
      auth: b64(rfc.auth),
    });
    expect(plain.toString("utf8")).toBe(rfc.plaintext);
  });

  test("2. round trip: an independent decrypt opens 10 random payloads of 1 to 256 bytes", () => {
    for (let i = 0; i < 10; i += 1) {
      const receiver = newReceiver();
      const plain = crypto.getRandomValues(new Uint8Array(1 + Math.floor(Math.random() * 256)));
      const body = encryptPushPayload(receiver.sub, plain);
      expect([...decryptPushBody(body, receiver)]).toEqual([...plain]);
    }
  });

  test("2b. every body has a fresh salt and sender key, and a header of 86 bytes: rs 4096, idlen 65", () => {
    const receiver = newReceiver();
    const a = Buffer.from(encryptPushPayload(receiver.sub, Buffer.from("x")));
    const b = Buffer.from(encryptPushPayload(receiver.sub, Buffer.from("x")));
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false);
    expect(a.readUInt32BE(16)).toBe(4096);
    expect(a[20]).toBe(65);
    expect(a.length).toBe(86 + 1 + 1 + 16);
  });

  test("3. the largest plaintext (3,993 bytes) fits the 4,096-byte body; 3,994 bytes is PushPayloadTooLarge", () => {
    const receiver = newReceiver();
    expect(MAX_PLAINTEXT_BYTES).toBe(3993);
    const biggest = encryptPushPayload(receiver.sub, new Uint8Array(3993));
    expect(biggest.length).toBe(4096);
    expect(decryptPushBody(biggest, receiver).length).toBe(3993);
    expect(() => encryptPushPayload(receiver.sub, new Uint8Array(3994))).toThrow(PushPayloadTooLarge);
  });

  test("4. a p256dh of 64 bytes is a PushKeyError and its message holds no input byte", () => {
    const receiver = newReceiver();
    const short = receiver.publicKey.subarray(0, 64).toString("base64url");
    let error: unknown;
    try {
      encryptPushPayload({ p256dh: short, auth: receiver.sub.auth }, new Uint8Array(1));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PushKeyError);
    expect((error as PushKeyError).field).toBe("p256dh");
    expect(`${(error as Error).message} ${String(error)}`).not.toContain(short.slice(8, 24));
    expect(`${(error as Error).message}`).not.toContain(receiver.sub.auth);
  });

  test("5. other bad keys: not base64url, wrong prefix byte, a point off the curve, a short auth secret, bad seam values", () => {
    const receiver = newReceiver();
    const ok = receiver.sub;
    const plain = new Uint8Array(1);
    const field = (sub: { p256dh: string; auth: string }, deps: EncryptDeps = {}): string | undefined => {
      try {
        encryptPushPayload(sub, plain, deps);
      } catch (error) {
        return error instanceof PushKeyError ? error.field : "other";
      }
      return undefined;
    };
    expect(field({ ...ok, p256dh: `${ok.p256dh.slice(0, 80)}+/==` })).toBe("p256dh");
    expect(field({ ...ok, p256dh: "" })).toBe("p256dh");
    const wrongPrefix = Buffer.from(receiver.publicKey);
    wrongPrefix[0] = 0x02;
    expect(field({ ...ok, p256dh: wrongPrefix.toString("base64url") })).toBe("p256dh");
    const offCurve = Buffer.from(receiver.publicKey);
    offCurve[64] = (offCurve[64] ?? 0) ^ 0xff;
    expect(field({ ...ok, p256dh: offCurve.toString("base64url") })).toBe("p256dh");
    expect(field({ ...ok, auth: ok.auth.slice(0, 10) })).toBe("auth");
    expect(field({ ...ok, auth: `${ok.auth}A` })).toBe("auth");
    expect(field(ok, { salt: new Uint8Array(15) })).toBe("salt");
    expect(field(ok, { ephemeral: { privateKey: b64(rfc.asPrivate), publicKey: b64(rfc.uaPublic) } })).toBe(
      "ephemeral"
    );
  });

  test("6. production code never passes the test seams (ephemeral key, salt)", () => {
    const dir = import.meta.dir;
    const sources = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    for (const name of sources.filter((n) => n !== "encrypt.ts")) {
      expect({ name, seam: /ephemeral\s*:|salt\s*:/.test(readFileSync(join(dir, name), "utf8")) }).toEqual({
        name,
        seam: false,
      });
    }
  });
});
