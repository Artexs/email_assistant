import { parseCallback, type Callback, type CallbackFamily } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { dispatchCallback, type CallbackHandler, type CallbackHandlers, type TapInput } from "./callbacks";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const input = {} as TapInput;

function recordingHandlers(calls: [CallbackFamily, Callback][]): CallbackHandlers {
  const record =
    (family: CallbackFamily) =>
    async (_input: TapInput, callback: Callback): Promise<{ answer: string }> => {
      calls.push([family, callback]);
      return { answer: family };
    };
  return {
    feedback: record("feedback"),
    answered: record("answered"),
    reply: record("reply"),
    loop: record("loop"),
    delegate: record("delegate"),
    approval: record("approval"),
  };
}

describe("dispatchCallback", () => {
  test.each<[string, CallbackFamily]>([
    [`fr:u:${ID}`, "feedback"],
    [`vx:${ID}`, "feedback"],
    [`ay:${ID}`, "answered"],
    ["rv", "reply"],
    [`lf:${ID}`, "loop"],
    [`dg:${ID}`, "delegate"],
    [`ap:${ID}`, "approval"],
  ])("%s runs only the %s handler", async (data, family) => {
    const calls: [CallbackFamily, Callback][] = [];
    const callback = parseCallback(data);
    if (callback === null) throw new Error(`${data} does not parse`);
    const result = await dispatchCallback(recordingHandlers(calls), input, callback);
    expect(result).toEqual({ answer: family });
    expect(calls).toEqual([[family, callback]]);
  });
});

describe("callback handler record", () => {
  test("a record without a handler for one family does not compile", () => {
    const record = async () => ({ answer: "" });
    // @ts-expect-error the `loop` handler is missing
    const incomplete: { [F in CallbackFamily]: CallbackHandler<F> } = {
      feedback: record,
      answered: record,
      reply: record,
      delegate: record,
      approval: record,
    };
    expect(Object.keys(incomplete)).toHaveLength(5);
  });
});
