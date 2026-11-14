import { describe, expect, test } from "bun:test";

import { evalCaseSchema } from "../triage/eval-case";

import type { CaseText } from "./files";
import { miniScenario } from "./fixtures";
import { slotSchema, type Slot } from "./slot";
import { type HtmlBodyInput, toEvalCase } from "./to-eval-case";

const HOUR_MS = 3_600_000;
const at = "2026-11-02T09:00:00.000Z";

function slot(over: Record<string, unknown> = {}): Slot {
  return slotSchema.parse({
    id: "b-inf-0001",
    part: "dev",
    batch: "batch-001",
    persona: "kasia",
    to: ["szef"],
    lang: "pl",
    receivedAt: at,
    category: "info",
    kind: "synthetic",
    style: { length: "short", format: "plain", signature: true, greeting: "formal" },
    brief: "a status update",
    ...over,
  });
}

function text(over: Partial<CaseText> = {}): CaseText {
  return { id: "b-inf-0001", subject: "Raport", body: "Dzień dobry, raport w załączniku.", thread: [], ...over };
}

function fakeHtml(result: string | null = "from html") {
  const calls: HtmlBodyInput[] = [];
  return {
    calls,
    deps: {
      async htmlBodyText(input: HtmlBodyInput) {
        calls.push(input);
        return result;
      },
    },
  };
}

const join = (s: Slot, t: CaseText, deps = fakeHtml().deps, parents?: { slot: Slot; text: CaseText }[]) =>
  toEvalCase({ slot: s, text: t, scenario: miniScenario, corpusVersion: "v1", parents }, deps);

describe("toEvalCase", () => {
  test("2 a plain slot joins its facts, the VIP rules and the delegates", async () => {
    const result = await join(slot(), text());
    expect(result.id).toBe("b-inf-0001");
    expect(result.from).toBe("Persona kasia <kasia@mini.test>");
    expect(result.to).toEqual(["szef@mini.test"]);
    expect(result.body).toBe(text().body);
    expect(result.receivedAt).toBe(at);
    expect(result.expected).toEqual({ category: "info", delegate: undefined, draft: undefined });
    expect(result.sim?.slotId).toBe("b-inf-0001");
    expect(result.sim?.corpus).toBe("mini");
    expect(result.sim?.version).toBe("v1");
    expect(result.sim?.urgencyProfile).toEqual(miniScenario.urgency.profile);
    expect(result.senderRules).toEqual([{ pattern: "prezes@mini.test", kind: "vip" }]);
    expect(result.delegates.map((d) => d.key)).toEqual(["anna", "marek"]);
    expect(result.delegates[0]).toEqual({ key: "anna", name: "Persona anna", tags: ["faktury", "ksiegowosc"] });
  });

  test("3 the text part wins; an html-only text reads the html through the dep", async () => {
    const htmlOnly = fakeHtml();
    const html = "<p>Dzień dobry</p>";
    const a = await join(
      slot({
        hardCases: ["html_only"],
        style: { length: "short", format: "html", signature: true, greeting: "formal" },
      }),
      text({ body: "", html }),
      htmlOnly.deps
    );
    expect(a.body).toBe("from html");
    expect(htmlOnly.calls).toHaveLength(1);
    expect(htmlOnly.calls[0]?.html).toBe(html);

    const withText = fakeHtml();
    const b = await join(
      slot({ style: { length: "short", format: "html", signature: true, greeting: "formal" } }),
      text({ html }),
      withText.deps
    );
    expect(b.body).toBe(text().body);
    expect(withText.calls).toHaveLength(0);

    const none = await join(slot(), text({ body: "", html }), fakeHtml(null).deps);
    expect(none.body).toBe("");
  });

  test("4 a bounce slot takes the from address of the override", async () => {
    const result = await join(slot({ fromOverride: "mailer-daemon@mini.test" }), text());
    expect(result.from).toBe("Persona kasia <mailer-daemon@mini.test>");
  });

  test("5 a two-mail thread gets times 2 h and 1 h before the case", async () => {
    const s = slot({
      thread: [
        { persona: "kasia", brief: "first" },
        { persona: "szef", brief: "second" },
      ],
    });
    const t = text({
      thread: [
        { subject: "Re: a", body: "one" },
        { subject: "Re: b", body: "two" },
      ],
    });
    const result = await join(s, t);
    const base = new Date(at).getTime();
    expect(result.thread.map((m) => m.receivedAt)).toEqual([
      new Date(base - 2 * HOUR_MS).toISOString(),
      new Date(base - HOUR_MS).toISOString(),
    ]);
    expect(result.thread.map((m) => m.from)).toEqual(["kasia@mini.test", "szef@mini.test"]);
    expect(result.thread.map((m) => m.body)).toEqual(["one", "two"]);
  });

  test("6 the result parses with the case schema, also for German", async () => {
    const result = await join(slot({ lang: "de" }), text());
    expect(evalCaseSchema.parse(result)).toEqual(result);
    expect(result.lang).toBe("de");
  });

  test("8 a week reply with 2 parents gets a thread in time order", async () => {
    const first = slot({ id: "w-1-001", part: "week", receivedAt: "2026-11-16T08:00:00.000Z" });
    const second = slot({ id: "w-1-002", part: "week", persona: "szef", receivedAt: "2026-11-16T09:30:00.000Z" });
    const reply = slot({ id: "w-1-003", part: "week", receivedAt: "2026-11-16T11:00:00.000Z" });
    const parents = [
      { slot: first, text: text({ id: first.id, subject: "Pytanie", body: "first body" }) },
      { slot: second, text: text({ id: second.id, subject: "Re: Pytanie", body: "second body" }) },
    ];
    const result = await join(reply, text({ id: reply.id, subject: "Re: Re: Pytanie" }), fakeHtml().deps, parents);
    expect(result.thread.map((m) => m.subject)).toEqual(["Pytanie", "Re: Pytanie"]);
    expect(result.thread.map((m) => m.receivedAt)).toEqual([first.receivedAt, second.receivedAt]);
    expect(result.thread.map((m) => m.from)).toEqual(["kasia@mini.test", "szef@mini.test"]);
    expect(result.thread.map((m) => m.body)).toEqual(["first body", "second body"]);
  });
});
