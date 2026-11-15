import { describe, expect, test } from "bun:test";

import { miniScenario, miniSentSlot, miniSentText } from "./fixtures";
import { sentEvalCase } from "./sent-eval-case";

describe("sentEvalCase", () => {
  test("T9 the case holds the blind view and the slot labels", () => {
    const evalCase = sentEvalCase(miniSentSlot, miniSentText, miniScenario);
    expect(evalCase.id).toBe("s-0001");
    expect(evalCase.part).toBe("sent-dev");
    expect(evalCase.blind.body).toBe(miniSentText.body);
    expect(evalCase.blind.to).toEqual(["client-a@client-a.test"]);
    expect(evalCase.labels).toEqual(miniSentSlot.labels);
    expect(evalCase.expected).toEqual({
      expectsReply: true,
      promise: true,
      due: "2026-11-20",
      promiseDue: "2026-11-25",
    });
    // The blind part has no label.
    expect(JSON.stringify(evalCase.blind)).not.toContain("expectsReply");
  });
});
