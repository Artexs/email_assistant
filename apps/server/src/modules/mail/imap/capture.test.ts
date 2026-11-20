import { describe, expect, test } from "bun:test";

import { contentFromHeaderBlock, contentFromSource } from "./capture";
import { bodyTextFromSource } from "./mapper";

function raw(lines: string[]): Buffer {
  return Buffer.from(lines.join("\r\n"));
}

const F1_HEADERS = [
  "Authentication-Results: mx.top.example; dmarc=fail header.from=evil.test; spf=fail",
  "Authentication-Results: mx.inner.example; dkim=pass",
  "Return-Path: <Bounce@Evil.test>",
  'From: "Jan Kowalski <ceo@corp.test>" <x@evil.test>',
  "To: me@corp.test",
  "Subject: Invoice",
  "Reply-To: other@else.test",
  "List-Unsubscribe: <https://u.test/x>, <mailto:u@u.test>",
  "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  "List-Id: News <news.list.test>",
  "Auto-Submitted: auto-replied",
  "Precedence: bulk",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
];

const F1_BODY = [
  "",
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "",
  `<p>Pay <a href="https://evil.test/pay">https://bank.test/login</a> and <a href='http://www.Shop.test:8080/a'>shop</a></p>`,
  "--b1",
  'Content-Type: text/calendar; name="invite.ics"',
  'Content-Disposition: attachment; filename="invite.ics"',
  "",
  "BEGIN:VCALENDAR",
  "--b1",
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4!").toString("base64"),
  "--b1--",
  "",
];

const F1_SOURCE = raw([...F1_HEADERS, ...F1_BODY]);

function simple(extra: string[], body: string[] = ["hello"]): Buffer {
  return raw(["From: a@a.test", "To: b@b.test", "Subject: s", ...extra, "", ...body]);
}

async function captureOf(source: Buffer) {
  const content = await contentFromSource(source);
  if (content?.capture === null || content === null) throw new Error("no capture");
  return content.capture;
}

function multipart(parts: string[]): Buffer {
  return raw([
    "From: a@a.test",
    "To: b@b.test",
    "Subject: s",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    ...parts,
    "--b1--",
    "",
  ]);
}

describe("captureFromParsed", () => {
  test("1: the F1 message gives every field", async () => {
    const capture = await captureOf(F1_SOURCE);
    expect(capture).toMatchObject({
      authResults: "mx.top.example; dmarc=fail header.from=evil.test; spf=fail",
      returnPath: "bounce@evil.test",
      fromName: "Jan Kowalski <ceo@corp.test>",
      replyTo: ["other@else.test"],
      listUnsubscribe: "<https://u.test/x>, <mailto:u@u.test>",
      listUnsubscribePost: true,
      listId: "News <news.list.test>",
      autoSubmitted: "auto-replied",
      precedence: "bulk",
      hasCalendar: true,
      attachmentCount: 2,
      links: [
        { host: "evil.test", textHost: "bank.test" },
        { host: "www.shop.test", textHost: null },
      ],
      linkCount: 2,
      partsKnown: true,
    });
    expect(capture.attachments[0]).toMatchObject({ name: "invite.ics", type: "text/calendar", inline: false });
    expect(capture.attachments[1]).toEqual({ name: "invoice.pdf", type: "application/pdf", size: 9, inline: false });
  });

  test("2: a plain text mail gives hosts from its URLs", async () => {
    const capture = await captureOf(simple([], ["see https://a.test/x and http://B.test."]));
    expect(capture.links).toEqual([
      { host: "a.test", textHost: null },
      { host: "b.test", textHost: null },
    ]);
  });

  test("3: the text of a link gives textHost only for a URL or a bare host", async () => {
    const html = [
      `<a href="https://x.test">pay.bank.test</a>`,
      `<a href="https://y.test">Click here</a>`,
      `<a href="mailto:a@b.test">mail</a>`,
      `<a href="javascript:void(0)">js</a>`,
    ].join(" ");
    const source = raw([
      "From: a@a.test",
      "To: b@b.test",
      "Subject: s",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      html,
    ]);
    expect((await captureOf(source)).links).toEqual([
      { host: "x.test", textHost: "pay.bank.test" },
      { host: "y.test", textHost: null },
    ]);
  });

  test("4: the limits cut the lists and strings", async () => {
    const attachments = Array.from({ length: 25 }, (_, i) => [
      "--b1",
      `Content-Type: application/octet-stream; name="f${i}.bin"`,
      `Content-Disposition: attachment; filename="f${i}.bin"`,
      "",
      "data",
    ]).flat();
    const manyAttachments = await captureOf(multipart(attachments));
    expect(manyAttachments.attachments).toHaveLength(20);
    expect(manyAttachments.attachmentCount).toBe(25);

    const links = Array.from({ length: 60 }, (_, i) => `<a href="https://h${i}.test/">x</a>`).join(" ");
    const manyLinks = await captureOf(raw(["From: a@a.test", "Content-Type: text/html; charset=utf-8", "", links]));
    expect(manyLinks.links).toHaveLength(50);
    expect(manyLinks.linkCount).toBe(60);

    const long = await captureOf(
      raw([
        `From: "${"n".repeat(300)}" <a@a.test>`,
        "Reply-To: " + Array.from({ length: 7 }, (_, i) => `r${i}@r.test`).join(", "),
        "",
        "hi",
      ])
    );
    expect(Array.from(long.fromName ?? "")).toHaveLength(200);
    expect(long.replyTo).toHaveLength(5);
  });

  test("5b: List-Unsubscribe-Post is true only for the exact RFC 8058 value (trimmed, any case)", async () => {
    const postOf = async (...extra: string[]) => (await captureOf(simple(extra))).listUnsubscribePost;
    const link = "List-Unsubscribe: <https://u.test/x>";
    expect(await postOf(link, "List-Unsubscribe-Post: List-Unsubscribe=One-Click")).toBe(true);
    expect(await postOf(link, "List-Unsubscribe-Post:   list-unsubscribe=one-click  ")).toBe(true);
    expect(await postOf(link, "list-unsubscribe-post: LIST-UNSUBSCRIBE=ONE-CLICK")).toBe(true);
    // A folded header line is one value.
    expect(await postOf(link, "List-Unsubscribe-Post:", " List-Unsubscribe=One-Click")).toBe(true);
    // Only the List-Unsubscribe header, an empty value, another value and a near miss are false.
    expect(await postOf(link)).toBe(false);
    expect(await postOf(link, "List-Unsubscribe-Post:")).toBe(false);
    expect(await postOf(link, "List-Unsubscribe-Post: List-Unsubscribe=One-Click-Not")).toBe(false);
    expect(await postOf(link, "List-Unsubscribe-Post: yes; List-Unsubscribe=One-Click")).toBe(false);
    // Two lines are never one-click: the old rule read the topmost line and gave true for the
    // second case; a repeated header can be a forged line above a signed one.
    expect(await postOf(link, "List-Unsubscribe-Post: no", "List-Unsubscribe-Post: List-Unsubscribe=One-Click")).toBe(
      false
    );
    expect(await postOf(link, "List-Unsubscribe-Post: List-Unsubscribe=One-Click", "List-Unsubscribe-Post: no")).toBe(
      false
    );
  });

  test("5d: more than one List-Unsubscribe or List-Unsubscribe-Post line gives no stored link and no one-click; one of each is as before", async () => {
    const post = "List-Unsubscribe-Post: List-Unsubscribe=One-Click";
    const one = await captureOf(simple(["List-Unsubscribe: <https://u.test/x>", post]));
    expect([one.listUnsubscribe, one.listUnsubscribePost]).toEqual(["<https://u.test/x>", true]);

    // The forged line on top of the signed one, with and without a second post line.
    const cases = [
      ["List-Unsubscribe: <https://evil.test/x>", "List-Unsubscribe: <https://u.test/x>", post],
      ["List-Unsubscribe: <https://u.test/x>", post, "List-Unsubscribe: <https://evil.test/x>"],
      ["List-Unsubscribe: <https://u.test/x>", post, post],
      ["List-Unsubscribe: <https://evil.test/x>", "list-unsubscribe: <https://u.test/x>", post, post],
    ];
    for (const lines of cases) {
      const capture = await captureOf(simple(lines));
      expect({ lines, link: capture.listUnsubscribe, post: capture.listUnsubscribePost }).toEqual({
        lines,
        link: null,
        post: false,
      });
    }
    // A repeated header that is not an unsubscribe header changes nothing.
    const other = await captureOf(simple(["List-Unsubscribe: <https://u.test/x>", post, "List-Id: a", "List-Id: b"]));
    expect([other.listUnsubscribe, other.listUnsubscribePost]).toEqual(["<https://u.test/x>", true]);
  });

  test("5e: the DKIM-Signature headers give only the domain and the header names, never the signature value", async () => {
    const signed = await captureOf(
      simple([
        "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=News.Example; s=sel; t=1;",
        "\th=From:To:Subject:List-Unsubscribe:",
        " LIST-UNSUBSCRIBE-Post; bh=SECRETBODYHASH=; b=SECRETSIGNATUREVALUE==",
        "List-Unsubscribe: <https://u.test/x>",
        "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
      ])
    );
    expect(signed.dkimSignatures).toEqual([
      { d: "news.example", h: ["from", "to", "subject", "list-unsubscribe", "list-unsubscribe-post"] },
    ]);
    expect(JSON.stringify(signed.dkimSignatures)).not.toContain("SECRET");
    // Two signatures keep their order; a body-only signature (no list headers in `h=`) stays as it is.
    const two = await captureOf(
      simple([
        "DKIM-Signature: v=1; d=a.example; h=from; bh=x; b=y",
        "dkim-signature: v=1; d=b.example; h=from:list-unsubscribe; bh=x; b=y",
      ])
    );
    expect(two.dkimSignatures).toEqual([
      { d: "a.example", h: ["from"] },
      { d: "b.example", h: ["from", "list-unsubscribe"] },
    ]);
    expect((await captureOf(simple([]))).dkimSignatures).toEqual([]);
  });

  test("5f: too many, a very long, a duplicate-tag and a missing-tag DKIM-Signature give no signature at all", async () => {
    const good = "DKIM-Signature: v=1; d=a.example; h=from:list-unsubscribe:list-unsubscribe-post; bh=x; b=y";
    expect((await captureOf(simple([good]))).dkimSignatures).toHaveLength(1);
    const nine = Array.from({ length: 9 }, () => good);
    expect((await captureOf(simple(nine))).dkimSignatures).toEqual([]);
    // 20 000 characters in `z=` and `b=` (a long header folded over many lines).
    const filler = Array.from({ length: 250 }, () => ` ${"A".repeat(78)}`);
    const long = ["DKIM-Signature: v=1; d=a.example; h=from:list-unsubscribe:list-unsubscribe-post; b=", ...filler];
    expect((await captureOf(simple(long))).dkimSignatures).toEqual([]);
    for (const bad of [
      "DKIM-Signature: v=1; d=a.example; d=b.example; h=from; b=y",
      "DKIM-Signature: v=1; d=a.example; b=y",
      "DKIM-Signature: v=1; h=from; b=y",
    ]) {
      expect((await captureOf(simple([good, bad]))).dkimSignatures).toEqual([]);
    }
  });

  test("5g: a mail with two copies of a list header is no one-click whatever its `h=` says", async () => {
    // `h=` names each header once, but the mail has two copies of List-Unsubscribe: the signature covers one instance only.
    const capture = await captureOf(
      simple([
        "DKIM-Signature: v=1; d=a.example; h=from:list-unsubscribe:list-unsubscribe-post; b=y",
        "List-Unsubscribe: <https://evil.test/x>",
        "List-Unsubscribe: <https://u.test/x>",
        "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
      ])
    );
    expect([capture.listUnsubscribe, capture.listUnsubscribePost]).toEqual([null, false]);
  });

  test("5: a mail without the headers gives null and empty values", async () => {
    expect(await captureOf(simple([]))).toEqual({
      fromName: null,
      replyTo: [],
      returnPath: null,
      authResults: null,
      listUnsubscribe: null,
      listUnsubscribePost: false,
      dkimSignatures: [],
      listId: null,
      autoSubmitted: null,
      precedence: null,
      hasCalendar: false,
      attachments: [],
      attachmentCount: 0,
      links: [],
      linkCount: 0,
      partsKnown: true,
    });
  });

  test("6: NUL is stripped from a display name; an empty name gives null", async () => {
    const withNul = await captureOf(raw(['From: "Ja\u0000n" <a@b.test>', "", "hi"]));
    expect(withNul.fromName).toBe("Jan");
    const empty = await captureOf(raw(['From: "" <a@b.test>', "", "hi"]));
    expect(empty.fromName).toBeNull();
  });

  test("7: an inline image part is inline", async () => {
    const capture = await captureOf(
      multipart([
        "--b1",
        'Content-Type: image/png; name="a.png"',
        "Content-Disposition: inline",
        "Content-ID: <img1>",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("png").toString("base64"),
      ])
    );
    expect(capture.attachments[0]?.inline).toBe(true);
  });

  test("8: a header block alone gives the header fields and partsKnown false", async () => {
    const content = await contentFromHeaderBlock(raw(F1_HEADERS));
    expect(content?.text).toBeNull();
    expect(content?.capture).toMatchObject({
      authResults: "mx.top.example; dmarc=fail header.from=evil.test; spf=fail",
      attachments: [],
      attachmentCount: 0,
      links: [],
      linkCount: 0,
      partsKnown: false,
    });
  });

  test("10: a source that is not a mail does not throw", async () => {
    expect(await contentFromSource(Buffer.from("not a mail"))).toEqual({
      text: null,
      capture: {
        fromName: null,
        replyTo: [],
        returnPath: null,
        authResults: null,
        listUnsubscribe: null,
        listUnsubscribePost: false,
        dkimSignatures: [],
        listId: null,
        autoSubmitted: null,
        precedence: null,
        hasCalendar: false,
        attachments: [],
        attachmentCount: 0,
        links: [],
        linkCount: 0,
        partsKnown: true,
      },
    });
  });

  test("11: a cut inside a surrogate pair leaves a well-formed name", async () => {
    const name = `${"y".repeat(199)}😀z.bin`;
    const capture = await captureOf(
      multipart([
        "--b1",
        `Content-Type: application/octet-stream; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "",
        "data",
      ])
    );
    const kept = capture.attachments[0]?.name ?? "";
    expect(Array.from(kept).length).toBeLessThanOrEqual(200);
    expect(kept.isWellFormed()).toBe(true);
    expect(JSON.stringify(capture)).not.toContain('\\ud83d"');
  });

  test("12: a 400 character Return-Path is cut to 320", async () => {
    const capture = await captureOf(simple([`Return-Path: <${"a".repeat(400)}>`]));
    expect(capture.returnPath).toHaveLength(320);
  });

  test("13: Auto-Submitted and Precedence keep only a token", async () => {
    const capture = await captureOf(simple(["Auto-Submitted: Auto-Replied; reason=x", "Precedence: <script>"]));
    expect(capture.autoSubmitted).toBe("auto-replied");
    expect(capture.precedence).toBe("other");
  });

  test("14: a capture error keeps the text and gives capture null", async () => {
    const normal = await contentFromSource(F1_SOURCE);
    const failing = await contentFromSource(F1_SOURCE, () => {
      throw new Error("x");
    });
    expect(failing?.capture).toBeNull();
    expect(failing?.text).toBe(normal?.text ?? "missing");
    expect(failing?.text).toContain("Pay");
  });

  test("9: bodyTextFromSource gives the text of contentFromSource", async () => {
    expect(await bodyTextFromSource(F1_SOURCE)).toBe((await contentFromSource(F1_SOURCE))?.text ?? null);
  });
});
