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

  test("5: a mail without the headers gives null and empty values", async () => {
    expect(await captureOf(simple([]))).toEqual({
      fromName: null,
      replyTo: [],
      returnPath: null,
      authResults: null,
      listUnsubscribe: null,
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
    await contentFromSource(Buffer.from("not a mail"));
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
