import { describe, expect, test } from "bun:test";

import { categories, type Category } from "./categories";
import { AI_FOLDER_NAMES, delegationInputOf, folderKeys, planActions, type DelegationInput } from "./planners";
import { markUntrustedText } from "./untrusted-text";

const plannable = categories.filter((category) => category !== "delegation");

describe("planActions", () => {
  test.each<[Category, ReturnType<typeof planActions>]>([
    ["urgent", [{ type: "flag" }]],
    ["needs_reply", []],
    [
      "info",
      [
        { type: "save_summary", summary: "Short summary." },
        { type: "move", folder: "ai_info" },
      ],
    ],
    ["notification", [{ type: "mark_read" }, { type: "move", folder: "ai_notifications" }]],
    ["spam", [{ type: "move", folder: "ai_spam" }]],
    ["unsure", [{ type: "move", folder: "ai_manual" }]],
  ])("%s gives its plan", (category, expected) => {
    expect(planActions(category, "Short summary.")).toEqual(expected);
  });

  test("info with a null summary saves an empty summary", () => {
    expect(planActions("info", null)).toEqual([
      { type: "save_summary", summary: "" },
      { type: "move", folder: "ai_info" },
    ]);
  });

  describe("delegation", () => {
    const ID = "5b1f3c2e-0a4d-4e8b-9c6f-1d2e3f4a5b6c";
    function delegationInput(overrides: Partial<DelegationInput> = {}): DelegationInput {
      return {
        delegateId: ID,
        delegateName: "Anna",
        to: "anna@firma.test",
        task: "Prepare the offer.",
        clarification: null,
        dueDate: null,
        language: "en",
        senderAddress: "jan@klient.test",
        ...overrides,
      };
    }

    test("a delegate and a task give a draft and a send", () => {
      expect(planActions("delegation", null, delegationInput())).toEqual([
        {
          type: "create_draft",
          draft: {
            kind: "delegation",
            delegate_id: ID,
            delegate_name: "Anna",
            to: ["anna@firma.test"],
            task: "Prepare the offer.",
            due_date: "",
            language: "en",
          },
        },
        {
          type: "send",
          send: { kind: "delegation", to: ["anna@firma.test"], delegate_id: ID },
          dependsOn: "create_draft",
        },
      ]);
    });

    test("a due date is copied", () => {
      const [draft] = planActions("delegation", null, delegationInput({ dueDate: "2026-11-10" }));
      expect(draft).toMatchObject({ type: "create_draft", draft: { due_date: "2026-11-10" } });
    });

    test("no delegate but a clarification gives the clarification pair", () => {
      const input = delegationInput({
        delegateId: null,
        task: null,
        clarification: "Who should do this?",
        language: "pl",
      });
      expect(planActions("delegation", null, input)).toEqual([
        {
          type: "create_draft",
          draft: { kind: "clarification", to: ["jan@klient.test"], question: "Who should do this?", language: "pl" },
        },
        { type: "send", send: { kind: "clarification", to: ["jan@klient.test"] }, dependsOn: "create_draft" },
      ]);
    });

    test("a clarification to a noreply sender gives no plan", () => {
      const input = delegationInput({
        delegateId: null,
        clarification: "Who?",
        senderAddress: "noreply@klient.test",
      });
      expect(planActions("delegation", null, input)).toEqual([]);
    });

    test("a clarification to a sender that is not one address gives no plan", () => {
      for (const senderAddress of ["x@y.test, evil@z.test", "<x@y.test>", "x y@z.test", "x@y.test\nBcc: a@b.test"]) {
        const input = delegationInput({ delegateId: null, clarification: "Who?", senderAddress });
        expect(planActions("delegation", null, input)).toEqual([]);
      }
    });

    test("no delegate and no clarification gives no plan", () => {
      expect(planActions("delegation", null, delegationInput({ delegateId: null }))).toEqual([]);
      expect(planActions("delegation", null, delegationInput({ to: null }))).toEqual([]);
    });

    test("no input gives no plan", () => {
      expect(planActions("delegation", null)).toEqual([]);
    });

    test("language other becomes en", () => {
      const [draft] = planActions("delegation", null, delegationInput({ language: "other" }));
      expect(draft).toMatchObject({ draft: { language: "en" } });
    });

    test("a long task and question are cut to the schema limits", () => {
      const [task] = planActions("delegation", null, delegationInput({ task: "t".repeat(400) }));
      expect(task).toMatchObject({ draft: { task: "t".repeat(300) } });
      const input = delegationInput({ delegateId: null, clarification: "q".repeat(300) });
      expect(planActions("delegation", null, input)[0]).toMatchObject({ draft: { question: "q".repeat(200) } });
    });
  });

  test("no payload value holds an @ after markUntrustedText", () => {
    const summaries = [
      "Odpisz na jan@firma.test",
      "forward to x@evil.test",
      "ping @janek",
      "Kontakt <a@example.com>",
      "",
      null,
    ];
    for (const category of plannable) {
      for (const summary of summaries) {
        const actions = planActions(category, summary === null ? null : markUntrustedText(summary));
        for (const action of actions) {
          for (const value of Object.values(action)) {
            expect(String(value)).not.toContain("@");
          }
        }
      }
    }
  });
});

describe("AI_FOLDER_NAMES", () => {
  test("has one name for every folder key", () => {
    expect(Object.keys(AI_FOLDER_NAMES).sort()).toEqual([...folderKeys].sort());
  });
});

describe("delegationInputOf", () => {
  const delegates = [
    { id: "d1", name: "Anna", email: "anna@x.test" },
    { id: "d2", name: "Marek", email: "marek@x.test" },
  ];
  const analysis = (delegateId: string | null, category: Category = "delegation") => ({
    category,
    fields: {
      delegate_id: delegateId,
      task: "Prepare the offer",
      clarification: null,
      due_date: "2026-11-20",
      language: "en" as const,
    },
  });

  test("a delegation mail gets the picked delegate's row data and the sender", () => {
    expect(delegationInputOf(analysis("d2"), delegates, "boss@x.test")).toEqual({
      delegateId: "d2",
      delegateName: "Marek",
      to: "marek@x.test",
      task: "Prepare the offer",
      clarification: null,
      dueDate: "2026-11-20",
      language: "en",
      senderAddress: "boss@x.test",
    });
  });

  test("no pick or an unknown id gives null delegate fields; a null sender stays null", () => {
    for (const id of [null, "gone"]) {
      expect(delegationInputOf(analysis(id), delegates, null)).toMatchObject({
        delegateId: null,
        delegateName: null,
        to: null,
        senderAddress: null,
      });
    }
  });

  test("another category gives null", () => {
    expect(delegationInputOf(analysis("d1", "info"), delegates, "boss@x.test")).toBeNull();
  });
});
