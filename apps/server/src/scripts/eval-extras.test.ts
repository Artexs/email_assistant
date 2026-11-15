import { evalCaseSchema, type EvalCase, miniScenario } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { classifierExtrasOfCase } from "./eval-extras";

const history = {
  days: 90,
  received: 2,
  byCategory: { spam: 2 },
  corrections: { info: 1 },
  movedBack: 0,
  answered: 0,
  flagged: 0,
  unseen7d: 0,
  userMailsTo: 0,
  lastUserMailDaysAgo: null,
  delegationsTo: 0,
  bulkSignals: [],
  firstSeenDaysAgo: 30,
  lastSeenDaysAgo: 2,
  medianUserReplyHours: null,
  medianTheirReplyHours: null,
  relation: "new",
};

function makeCase(id: string, sim: Record<string, unknown>, patch: Partial<EvalCase> = {}): EvalCase {
  return evalCaseSchema.parse({
    id,
    kind: "synthetic",
    lang: "en",
    from: "Persona client-a <client-a@client-a.test>",
    to: ["szef@mini.test"],
    subject: "Subject",
    body: "Body",
    expected: { category: "info" },
    sim: { corpus: "mini", version: "1", part: "dev", slotId: id, ...sim },
    ...patch,
  });
}

describe("classifierExtrasOfCase", () => {
  test("7. the history keeps days, received and corrections, not byCategory; the look-alike phishing case gets null", () => {
    const own = classifierExtrasOfCase(makeCase("c1", { senderHistory: history }), miniScenario);
    expect(own.senderHistory).toEqual({ days: 90, received: 2, corrections: { info: 1 } });
    expect(own.senderHistory).not.toHaveProperty("byCategory");

    const phishing = makeCase(
      "c2",
      { senderHistory: history, hardCases: ["phishing_delegation"] },
      { from: "Billing <billing@vendor-k.test>" }
    );
    expect(classifierExtrasOfCase(phishing, miniScenario).senderHistory).toBeNull();
  });

  test("a case with no sim facts gives empty extras", () => {
    const bare = evalCaseSchema.parse({
      id: "c3",
      kind: "synthetic",
      lang: "en",
      from: "a@client-a.test",
      to: ["szef@mini.test"],
      subject: "S",
      body: "B",
      expected: { category: "info" },
    });
    expect(classifierExtrasOfCase(bare, miniScenario)).toEqual({
      attachments: [],
      isList: false,
      senderHistory: null,
      urgency: null,
    });
  });

  test("attachments take the type of the name, size null, at most 10; a List-Id header sets isList", () => {
    const sim = {
      headers: { "List-Id": "<news.client-a.test>" },
      attachments: Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.pdf`, mime: "x/y", sizeBytes: 5 })),
    };
    const extras = classifierExtrasOfCase(makeCase("c4", sim), miniScenario);
    expect(extras.isList).toBe(true);
    expect(extras.attachments).toHaveLength(10);
    expect(extras.attachments[0]).toEqual({ name: "f0.pdf", type: "application/pdf", size: null });
  });

  test("urgency: today is the local date of receivedAt in the scenario time zone; deadlines are filtered", () => {
    const profile = {
      topics: [{ label: "Audit", keywords: ["kontrola"] }],
      deadlines: ["2027-01-13", "2027-01-14", "2027-02-14", "2027-02-15"].map((due) => ({ label: due, due })),
    };
    // 23:30 UTC on 01-14 is 00:30 on 01-15 in Warsaw.
    const evalCase = makeCase("c5", { urgencyProfile: profile }, { receivedAt: "2027-01-14T23:30:00Z" });
    const { urgency } = classifierExtrasOfCase(evalCase, miniScenario);
    expect(urgency?.today).toBe("2027-01-15");
    expect(urgency?.deadlines.map((deadline) => deadline.due)).toEqual(["2027-01-14", "2027-02-14"]);
    expect(urgency?.topics).toEqual(profile.topics);
  });
});
