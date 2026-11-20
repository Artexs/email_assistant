import { describe, expect, test } from "bun:test";

import { type OutMessage } from "../digest/message";

import { encodeNoticeView } from "./encode";
import { type NoticeKind, noticeChannels, noticeKinds, type NoticeRenderOptions, reportMailKinds } from "./kinds";
import { pushKinds, pushPayloadSchema } from "./push";
import {
  id1,
  id2,
  now,
  receivedAt,
  timeZone,
  opts,
  urgentView,
  approvalView,
  setItems,
  cases,
  stored,
} from "./registry.test-helper";
import { renderNotice, renderNoticeEdit } from "./render";
import { noticeRenderers } from "./renderers";
import { noticeViewSchemas } from "./views";

describe("the mail channel (F110 stage 20)", () => {
  const mail: NoticeRenderOptions = { channel: "mail", detail: "full", locale: "en" };

  test("exactly the report kinds have a mail renderer", () => {
    const withMail = noticeKinds.filter((kind) => noticeRenderers[kind].mail !== undefined);
    expect([...withMail].sort()).toEqual([...reportMailKinds].sort());
  });

  test("a report kind renders the text of its Telegram notice with no button, in both languages", () => {
    for (const locale of ["en", "pl"] as const) {
      for (const kind of reportMailKinds) {
        const testCase = cases.find((candidate) => candidate.kind === kind);
        if (testCase === undefined) throw new Error("no case");
        const view = stored(testCase);
        const telegram = renderNotice(kind, view, { ...opts, locale });
        const rendered = renderNotice(kind, view, { ...mail, locale });
        expect(telegram.ok && rendered.ok).toBe(true);
        if (!telegram.ok || !rendered.ok) continue;
        expect(rendered.message.text).toBe(telegram.message.text);
        expect(rendered.message.buttons).toEqual([]);
      }
    }
  });

  test("a digest row with buttons loses them in the mail", () => {
    const rendered = renderNotice("digest", { text: "x", buttons: [[{ text: "Open", data: "d" }]] }, mail);
    expect(rendered).toEqual({ ok: true, message: { text: "x", buttons: [] } });
    expect(renderNotice("digest", { text: "x", buttons: [[{ text: "Open", data: "d" }]] }, opts).ok).toBe(true);
  });

  test("every other kind answers { ok: false } for a mail row: urgent mail and approvals never go by mail", () => {
    for (const testCase of cases) {
      if ((reportMailKinds as readonly string[]).includes(testCase.kind)) continue;
      expect(renderNotice(testCase.kind, stored(testCase), mail), testCase.kind).toEqual({ ok: false });
    }
  });

  test("a view that its schema rejects gives { ok: false } for a mail row", () => {
    expect(renderNotice("digest", { text: "", buttons: [] }, mail)).toEqual({ ok: false });
  });

  test("renderNoticeEdit throws for a mail row: a card edit has no mail form", () => {
    const input = {
      original: "x",
      outcome: "approved" as const,
      at: new Date("2026-11-13T10:00:00.000Z"),
      timeZone: "Europe/Warsaw",
    };
    expect(() => renderNoticeEdit(input, mail)).toThrow("no card edit for channel mail");
  });
});

describe("the push channel (F118 stage 08)", () => {
  const push: NoticeRenderOptions = { channel: "push", detail: "full", locale: "en" };

  // Plants a CANARY string in every string field of the stored view that the strict schema still accepts (free text, names, ids).
  // A field that the schema restricts (a date, a code, a UUID) keeps its value. The planted view stays valid.
  function planted(kind: NoticeKind, view: unknown): unknown {
    const schema = noticeViewSchemas[kind];
    let current = JSON.parse(JSON.stringify(view)) as unknown;
    let n = 0;
    const paths: (string | number)[][] = [];
    const walk = (value: unknown, path: (string | number)[]): void => {
      if (typeof value === "string") paths.push(path);
      else if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, index]));
      else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) walk(item, [...path, key]);
      }
    };
    walk(current, []);
    for (const path of paths) {
      const copy = JSON.parse(JSON.stringify(current)) as Record<string | number, unknown>;
      let target = copy;
      for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
      n += 1;
      target[path[path.length - 1] as string | number] = `CANARY${n}SUBJFROMBODY`;
      if (schema.safeParse(copy).success) current = copy;
    }
    return current;
  }

  test("1. exactly the push kinds have a push renderer; every other kind answers { ok: false } for a push row", () => {
    expect(noticeKinds.filter((kind) => noticeRenderers[kind].push !== undefined).sort()).toEqual(
      [...pushKinds].sort()
    );
    expect([...noticeChannels]).toEqual(["telegram", "mail", "push"]);
    for (const testCase of cases) {
      if ((pushKinds as readonly string[]).includes(testCase.kind)) continue;
      expect(renderNotice(testCase.kind, stored(testCase), push), testCase.kind).toEqual({ ok: false });
    }
  });

  test("2. every push kind renders exactly v, kind, count, itemId and lang, and no string of the view but the item id", () => {
    for (const kind of pushKinds) {
      const testCase = cases.find((candidate) => candidate.kind === kind);
      if (testCase === undefined) throw new Error(`no case for ${kind}`);
      const view = planted(kind, stored(testCase));
      for (const locale of ["en", "pl"] as const) {
        const rendered = renderNotice(kind, view, { ...push, locale });
        expect(rendered.ok, kind).toBe(true);
        if (!rendered.ok) continue;
        expect(rendered.message.buttons, kind).toEqual([]);
        const body = JSON.parse(rendered.message.text) as Record<string, unknown>;
        expect(Object.keys(body).sort(), kind).toEqual(["count", "itemId", "kind", "lang", "v"]);
        expect(body.kind).toBe(kind);
        expect(body.lang).toBe(locale);
        expect(body.v).toBe(1);
        // The payload passes the strict schema of the service worker once the sender has added `id`.
        expect(pushPayloadSchema.safeParse({ ...body, id: "row" }).success, kind).toBe(true);
        const { itemId, ...rest } = body;
        expect(JSON.stringify(rest), kind).not.toContain("CANARY");
        const expected = {
          approval: (view as { actionId: string }).actionId,
          send_result: (view as { actionId: string }).actionId,
          approval_set: (view as { setId: string }).setId,
          delegation_answered: (view as { delegationId: string }).delegationId,
        }[kind as string];
        expect(itemId, kind).toBe(expected ?? null);
      }
      // The planting reached the free text of the view: the view is not the clean fixture any more.
      if (["urgent", "approval", "send_result", "delegation_answered", "not_triaged", "approval_set"].includes(kind)) {
        expect(JSON.stringify(view), kind).toContain("CANARY");
      }
    }
  });

  test("3. an approval set of 3 items counts 3; an approval names its action id; the mail id of an urgent mail never goes out", () => {
    const set = { setId: id1, items: [...setItems, { ...setItems[0], n: 3 }], timeZone };
    const rendered = renderNotice("approval_set", encodeNoticeView("approval_set", set as never), push);
    expect(rendered.ok && JSON.parse(rendered.message.text)).toEqual({
      v: 1,
      kind: "approval_set",
      count: 3,
      itemId: id1,
      lang: "en",
    });
    const approval = renderNotice(
      "approval",
      encodeNoticeView("approval", { actionId: id2, view: approvalView, now, timeZone }),
      push
    );
    expect(approval.ok && JSON.parse(approval.message.text)).toEqual({
      v: 1,
      kind: "approval",
      count: 1,
      itemId: id2,
      lang: "en",
    });
    const urgent = renderNotice("urgent", encodeNoticeView("urgent", urgentView), { ...push, locale: "pl" });
    expect(urgent.ok && JSON.parse(urgent.message.text)).toEqual({
      v: 1,
      kind: "urgent",
      count: 1,
      itemId: null,
      lang: "pl",
    });
    expect(urgent.ok && urgent.message.text).not.toContain(id1);
  });

  test("4. replies_ready counts its replies, a count over the payload limit is cut, an item id over 64 characters fails the render", () => {
    const ready = (count: number) =>
      renderNotice("replies_ready", encodeNoticeView("replies_ready", { count, now, timeZone, review: true }), push);
    expect(ready(3).ok && JSON.parse((ready(3) as { message: OutMessage }).message.text).count).toBe(3);
    expect(ready(1_000_000).ok && JSON.parse((ready(1_000_000) as { message: OutMessage }).message.text).count).toBe(
      99_999
    );
    const long = renderNotice(
      "delegation_answered",
      encodeNoticeView("delegation_answered", {
        delegationId: "d".repeat(65),
        delegateName: "Anna",
        subject: null,
        receivedAt,
        now,
        timeZone,
        synthetic: false,
      }),
      push
    );
    expect(long).toEqual({ ok: false });
  });

  test("5. a view that its schema rejects gives { ok: false } for a push row, and a card edit still throws", () => {
    expect(renderNotice("urgent", { emailId: id1 }, push)).toEqual({ ok: false });
    const input = {
      original: "x",
      outcome: "approved" as const,
      at: new Date("2026-11-13T10:00:00.000Z"),
      timeZone: "Europe/Warsaw",
    };
    expect(() => renderNoticeEdit(input, push)).toThrow("no card edit for channel push");
  });
});
