# F100 stage 01 — Capture parser

Part of [`../plan.md`](../plan.md).

After this stage one pure function in the IMAP adapter turns a parsed mail into `CapturedHeaders` (D2), and one function parses a raw source once into its text and its capture. Nothing calls them from the sync yet (stage 02 changes the port, stage 05 stores the result).

## Step 1 — The type and the parser

**Goal.** One shape for the captured fields (D2), filled from `mailparser` output by fixed rules.

**Files.** `apps/server/src/modules/mail/port.ts` (the types), `apps/server/src/modules/mail/imap/capture.ts` (new), `apps/server/src/modules/mail/imap/capture.test.ts` (new), `apps/server/src/modules/mail/imap/mapper.ts` (reuse `stripNul`, `cleanOrNull`; export them if needed), `apps/server/src/modules/mail/index.ts` (export the types).

**Interfaces.**

```ts
// port.ts — the shape every adapter returns (E9 Graph and Gmail adapters return the same).
export const CAPTURE_LIMITS = {
  fromName: 200,
  replyTo: 5,
  authResults: 1000,
  listUnsubscribe: 1000,
  listId: 300,
  autoSubmitted: 100,
  precedence: 50,
  attachments: 20,
  attachmentName: 200,
  attachmentType: 100,
  links: 50,
  host: 253,
} as const;

export interface CapturedAttachment {
  name: string | null;
  type: string; // lower case, e.g. "application/pdf"
  size: number; // bytes, ≥ 0
  inline: boolean; // contentDisposition "inline" or a related part with a content id
}

export interface CapturedLink {
  host: string; // lower case, no port, no trailing dot
  textHost: string | null; // the host that the visible link text shows, when the text is a URL or a bare host
}

export interface CapturedHeaders {
  fromName: string | null;
  replyTo: string[]; // addresses, lower case, ≤ 5
  returnPath: string | null; // address, lower case
  authResults: string | null; // the topmost Authentication-Results value
  listUnsubscribe: string | null;
  listId: string | null;
  autoSubmitted: string | null; // lower case
  precedence: string | null; // lower case
  hasCalendar: boolean;
  attachments: CapturedAttachment[]; // ≤ 20, in part order
  attachmentCount: number; // all parts, also past the 20
  links: CapturedLink[]; // ≤ 50, first seen first, unique by (host, textHost)
  linkCount: number; // unique pairs before the cut
  partsKnown: boolean; // false: only the header block was read (attachments and links unknown)
}

export interface MailContent {
  text: string | null;
  capture: CapturedHeaders | null;
}

// imap/capture.ts
export function captureFromParsed(parsed: ParsedMail, opts: { partsKnown: boolean }): CapturedHeaders;
/** One `simpleParser` call: the text as `bodyTextFromSource` gives it, and the capture. Null on a parse error. */
export async function contentFromSource(source: Buffer): Promise<MailContent | null>;
/** For a mail over the size limit: the header block only; `text` null, `partsKnown` false. Null on a parse error. */
export async function contentFromHeaderBlock(headers: Buffer): Promise<MailContent | null>;
```

Rules (D2):

- Header values come from `parsed.headerLines` (`key` is lower case, `line` is `Name: value`): the value is `line` after the first `:`, unfolded (`\r?\n[ \t]+` → one space), trimmed. Take the **first** line of a key (the topmost). Never read `parsed.headers` for `list-unsubscribe` or `list-id` (mailparser drops them there, plan F1).
- `fromName`: `parsed.from?.value[0]?.name`, cleaned; empty → null. Keep it as it is (an address inside the name stays: E3b's display-name rule needs it).
- `replyTo`: `parsed.replyTo?.value` addresses, lower case, unique, first 5.
- `returnPath`: the address in the first `return-path` line (`<a@b>` → `a@b`, lower case); `<>` or empty → null.
- Cut every string to its limit (`slice(0, limit)`), after `stripNul` and trim. An empty string → null.
- `hasCalendar`: `parsed.headerLines` content type starts with `text/calendar`, or any attachment `contentType` is `text/calendar`.
- `attachments`: from `parsed.attachments` in order: `name = filename ?? null`, `type = contentType.toLowerCase()`, `size = size ?? content.length`, `inline = contentDisposition === "inline" || (related === true && cid !== undefined)`. Never keep `content`.
- `links`: from `parsed.html` when it is a string: every `<a …href="…"…>text</a>` (quotes `"`, `'` or none; case-insensitive tag and attribute). `href` that parses with `new URL()` and has protocol `http:` or `https:` → `host = url.hostname` lower case, trailing `.` removed. Visible text: tags removed, HTML entities `&amp; &lt; &gt; &quot; &#39;` decoded, trimmed; if it parses as an `http(s)` URL → its host; else if it matches `^[a-z0-9.-]+\.[a-z]{2,}$` (lower-cased) → the text itself; else `textHost = null`. Without an HTML part: every `https?://[^\s<>"')]+` in `parsed.text` gives `{ host, textHost: null }`. Unique by `${host} ${textHost}`; `linkCount` counts the unique pairs; keep the first 50.
- `contentFromSource` returns `{ text, capture }` where `text` follows exactly the rules of today's `bodyTextFromSource` (text part, else the HTML as text with `html-to-text`, `stripNul`, trim, cut at 100,000). Change `bodyTextFromSource` to `(await contentFromSource(source))?.text ?? null` so both share one parse.
- `contentFromHeaderBlock`: `simpleParser(Buffer.concat([headers, Buffer.from("\r\n\r\n")]))`, `text: null`, capture with `partsKnown: false`, `attachments: []`, `attachmentCount: 0`, `links: []`, `linkCount: 0`, `hasCalendar` from the header only.

**Decisions.** D2, D3.

**Test** (unit, `capture.test.ts`; raw messages are string arrays joined with `\r\n`, all addresses on `.test` domains):

1. The plan F1 message (copy it: two `Authentication-Results` lines `mx.top.example; dmarc=fail header.from=evil.test; spf=fail` then `mx.inner.example; dkim=pass`, `Return-Path: <Bounce@Evil.test>`, `From: "Jan Kowalski <ceo@corp.test>" <x@evil.test>`, `Reply-To: other@else.test`, `List-Unsubscribe: <https://u.test/x>, <mailto:u@u.test>`, `List-Id: News <news.list.test>`, `Auto-Submitted: auto-replied`, `Precedence: bulk`, a `multipart/mixed` body with an HTML part `<p>Pay <a href="https://evil.test/pay">https://bank.test/login</a> and <a href='http://www.Shop.test:8080/a'>shop</a></p>`, a `text/calendar` part `invite.ics`, a PDF attachment `invoice.pdf`) → `authResults = "mx.top.example; dmarc=fail header.from=evil.test; spf=fail"`, `returnPath = "bounce@evil.test"`, `fromName = "Jan Kowalski <ceo@corp.test>"`, `replyTo = ["other@else.test"]`, `listUnsubscribe = "<https://u.test/x>, <mailto:u@u.test>"`, `listId = "News <news.list.test>"`, `autoSubmitted = "auto-replied"`, `precedence = "bulk"`, `hasCalendar = true`, `attachments = [{ name: "invite.ics", type: "text/calendar", … }, { name: "invoice.pdf", type: "application/pdf", size: 9, inline: false }]`, `attachmentCount = 2`, `links = [{ host: "evil.test", textHost: "bank.test" }, { host: "www.shop.test", textHost: null }]`, `linkCount = 2`, `partsKnown = true`.
2. A plain-text mail with `see https://a.test/x and http://B.test.` and no HTML → `links = [{ host: "a.test", textHost: null }, { host: "b.test", textHost: null }]`.
3. A link whose text is a bare host: `<a href="https://x.test">pay.bank.test</a>` → `textHost = "pay.bank.test"`; text `Click here` → `textHost = null`; `href="mailto:a@b.test"` and `href="javascript:void(0)"` → no link.
4. Limits: 25 attachments → 20 kept, `attachmentCount = 25`; 60 distinct links → 50 kept, `linkCount = 60`; a 300-char display name → 200 chars; 7 `Reply-To` addresses → 5.
5. No such headers (a minimal mail with only `From`, `To`, `Subject`, text) → every string null, arrays empty, `hasCalendar = false`, `partsKnown = true`.
6. A display name with U+0000 inside → stripped; an empty display name `"" <a@b.test>` → `fromName = null`.
7. An inline image part (`Content-Disposition: inline`, `Content-ID: <img1>`) → `inline = true`.
8. `contentFromHeaderBlock` of the header lines of case 1 → `text = null`, `partsKnown = false`, `authResults` as case 1, `attachments = []`, `links = []`.
9. `bodyTextFromSource` gives the same text as before for the existing `mapper.test.ts` cases (keep those cases green, unchanged).
10. `contentFromSource(Buffer.from("not a mail"))` does not throw (returns a value or null; assert no throw).

**Check.** `bun test apps/server/src/modules/mail/imap/capture.test.ts apps/server/src/modules/mail/imap/mapper.test.ts`

**Done when.** Cases 1–10 pass; `bun run lint` passes (only `mail/imap/` imports `mailparser`).

**Out of scope.** The port method and the adapters (stage 02); storing the capture (stage 05); any rule that reads it (E3b).

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f100-s01`).
