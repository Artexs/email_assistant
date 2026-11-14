import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";
import type { ActionType, MoveTarget } from "../triage/planners";

import { type ActionView, describeAction, describeActions } from "./would-do";

function act(type: ActionType, status: string, folder: MoveTarget | null = null, reverse = false): ActionView {
  return {
    id: "a1",
    type,
    status,
    folder,
    reverse,
    reversesActionId: reverse ? "a0" : null,
    appliedAt: null,
    kind: null,
    delegateId: null,
  };
}

const ANNA = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const names = new Map([[ANNA, "Anna Nowak"]]);
const EN = textTables.en;
const PL = textTables.pl;

function draft(status: string, kind: ActionView["kind"] = "delegation", reverse = false): ActionView {
  return { ...act("create_draft", status, null, reverse), kind, delegateId: kind === "clarification" ? null : ANNA };
}

function send(status: string, kind: ActionView["kind"] = "delegation"): ActionView {
  return { ...act("send", status), kind, delegateId: kind === "clarification" ? null : ANNA };
}

describe("describeActions", () => {
  test.each<[string, ActionView[], string]>([
    ["flag logged", [act("flag", "logged")], "would flag"],
    [
      "save_summary is ignored",
      [act("save_summary", "ready"), act("move", "logged", "ai_info")],
      "would move to AI/Info",
    ],
    [
      "same tense is grouped",
      [act("mark_read", "logged"), act("move", "logged", "ai_notifications")],
      "would mark read, move to AI/Notifications",
    ],
    ["no actions", [], "stays in INBOX"],
    ["mixed tenses", [act("flag", "applied"), act("move", "logged", "ai_info")], "done: flag; would move to AI/Info"],
    ["move into INBOX", [act("move", "logged", "inbox")], "would move to INBOX"],
    ["move without folder", [act("move", "logged")], "would move"],
    ["undone original", [act("move", "undone", "ai_info")], "undone: move to AI/Info"],
    [
      "reverse row is skipped",
      [act("move", "undone", "ai_info"), act("move", "applied", "ai_info", true)],
      "undone: move to AI/Info",
    ],
    ["rejected is left out", [act("flag", "rejected")], "stays in INBOX"],
  ])("%s", (_name, actions, expected) => {
    expect(describeActions(actions, new Map(), {}, EN)).toBe(expected);
  });
});

describe("describeActions for drafts and sends", () => {
  test.each<[string, string]>([
    ["logged", "would draft a delegation to Anna Nowak"],
    ["ready", "will draft a delegation to Anna Nowak"],
    ["applying", "will draft a delegation to Anna Nowak"],
    ["applied", "done: draft a delegation to Anna Nowak"],
    ["failed", "failed: draft a delegation to Anna Nowak"],
    ["undone", "stays in INBOX"],
    ["expired", "stays in INBOX"],
  ])("draft %s", (status, expected) => {
    expect(describeActions([draft(status)], names, {}, EN)).toBe(expected);
  });

  test("the phrase by kind and the name fallback", () => {
    expect(describeActions([draft("ready", "clarification")], names, {}, EN)).toBe(
      "will draft a question to the sender"
    );
    expect(describeActions([draft("ready", "reminder")], names, {}, EN)).toBe("will draft a reminder to Anna Nowak");
    expect(describeActions([draft("ready")], new Map(), {}, EN)).toBe("will draft a delegation to a delegate");
    expect(describeActions([draft("ready")], new Map(), {}, EN)).toBe("will draft a delegation to a delegate");
  });

  test.each<[string, string]>([
    ["logged", "would ask you to send it"],
    ["awaiting_approval", "waits for your approval"],
    ["approved", "approved, sending"],
    ["applying", "sending"],
    ["applied", "sent"],
    ["rejected", "rejected"],
    ["expired", "not sent (approval expired)"],
    ["failed", "not sent (failed)"],
  ])("send %s", (status, expected) => {
    expect(describeActions([send(status)], names, {}, EN)).toBe(expected);
  });

  test("an approved send held by the send limit says so; every other status keeps its phrase", () => {
    const held = { ...send("approved"), waiting: "send_limit" as const };
    expect(describeAction(held, names, EN)).toBe("approved, waiting: send limit");
    expect(describeAction(send("approved"), names, EN)).toBe("approved, sending");
    expect(describeActions([draft("ready"), held], names, {}, EN)).toBe(
      "will draft a delegation to Anna Nowak; approved, waiting: send limit"
    );
    expect(describeActions([act("flag", "ready"), held], names, {}, EN)).toBe(
      "will flag; approved, waiting: send limit"
    );
  });

  test("the stay folder is named when no action applies", () => {
    expect(describeActions([], new Map(), { stayFolder: "Wiadomości-śmieci" }, EN)).toBe("stays in Wiadomości-śmieci");
    expect(describeActions([], new Map(), {}, EN)).toBe("stays in INBOX");
  });

  test("a long stay folder name is cut", () => {
    const text = describeActions([], new Map(), { stayFolder: "F".repeat(45) }, EN);
    expect(text.startsWith("stays in FFFF")).toBe(true);
    expect(text.length).toBeLessThan("stays in ".length + 45);
  });

  test("a draft and a send join with a semicolon", () => {
    expect(describeActions([draft("ready"), send("awaiting_approval")], names, {}, EN)).toBe(
      "will draft a delegation to Anna Nowak; waits for your approval"
    );
  });

  test("an undone draft plus an applied send reads from the send", () => {
    expect(describeActions([draft("undone"), send("applied")], names, {}, EN)).toBe("sent");
  });

  test("a reverse draft row is skipped", () => {
    expect(
      describeActions([draft("applied"), draft("ready", "delegation", true), send("applied")], names, {}, EN)
    ).toBe("done: draft a delegation to Anna Nowak; sent");
  });

  test("two sends with the same phrase print it once", () => {
    expect(describeActions([send("applied"), send("applied")], names, {}, EN)).toBe("sent");
    expect(describeActions([draft("undone"), send("applied"), send("applied")], names, {}, EN)).toBe("sent");
  });
});

describe("describeAction", () => {
  const statuses = [
    "ready",
    "applying",
    "applied",
    "awaiting_approval",
    "approved",
    "rejected",
    "expired",
    "undone",
    "logged",
    "failed",
  ];
  const makers: [string, (status: string) => ActionView][] = [
    ["flag", (status) => act("flag", status)],
    ["mark_read", (status) => act("mark_read", status)],
    ["move", (status) => act("move", status, "ai_notifications")],
    ["create_draft", (status) => draft(status)],
    ["send", (status) => send(status)],
  ];

  for (const [type, make] of makers) {
    test(`${type} matches describeActions for every status`, () => {
      for (const status of statuses) {
        const action = make(status);
        const line = describeActions([action], names, {}, EN);
        expect(describeAction(action, names, EN)).toBe(line.startsWith("stays in") ? null : line);
      }
    });
  }

  test("pinned phrases and nulls", () => {
    expect(describeAction(act("move", "applied", "ai_notifications"), new Map(), EN)).toBe(
      "done: move to AI/Notifications"
    );
    expect(describeAction(send("awaiting_approval"), new Map(), EN)).toBe("waits for your approval");
    expect(describeAction(act("flag", "applied", null, true), new Map(), EN)).toBeNull();
    expect(describeAction(act("save_summary", "applied"), new Map(), EN)).toBeNull();
    expect(describeAction(draft("undone"), new Map(), EN)).toBeNull();
  });
});

describe("Polish action phrases", () => {
  const jan = new Map([["d1", "Jan"]]);
  const delegation = (status: string, delegateId: string | null): ActionView => ({
    ...act("create_draft", status),
    kind: "delegation",
    delegateId,
  });

  test("a move that would happen", () => {
    expect(describeActions([act("move", "logged", "ai_info")], jan, {}, PL)).toBe("zrobiłby – przenieść do AI/Info");
  });

  test("a move and a flag that were done use the noun form", () => {
    expect(describeActions([act("move", "applied", "ai_info"), act("flag", "applied")], jan, {}, PL)).toBe(
      "zrobione – przeniesienie do AI/Info, oznaczenie flagą"
    );
  });

  test("a delegation draft names the delegate in parentheses", () => {
    expect(describeActions([delegation("ready", "d1")], jan, {}, PL)).toBe(
      "zrobi – przygotować szkic zlecenia (wykonawca Jan)"
    );
    expect(describeActions([delegation("ready", "unknown")], jan, {}, PL)).toBe("zrobi – przygotować szkic zlecenia");
  });

  test("a send waits for approval", () => {
    expect(describeActions([send("awaiting_approval")], names, {}, PL)).toBe("czeka na Twoje zatwierdzenie");
  });

  test("no action keeps the message in INBOX", () => {
    expect(describeActions([], jan, {}, PL)).toBe("zostaje w INBOX");
  });

  test("a failed mark read", () => {
    expect(describeAction(act("mark_read", "failed"), jan, PL)).toBe("nieudane – oznaczenie jako przeczytanej");
  });

  test("the other draft kinds and the send-limit wait", () => {
    expect(describeActions([draft("applied", "clarification")], jan, {}, PL)).toBe(
      "zrobione – szkic pytania do nadawcy"
    );
    expect(describeActions([{ ...draft("ready", "reminder"), delegateId: "d1" }], jan, {}, PL)).toBe(
      "zrobi – przygotować szkic przypomnienia (wykonawca Jan)"
    );
    expect(describeAction({ ...send("approved"), waiting: "send_limit" }, jan, PL)).toBe(
      "zatwierdzone, czeka (limit wysyłki)"
    );
  });

  // A composed line holds at most one colon, and never a colon with a dash.
  test("a line that joins every tense, a delegate and a send wait holds no colon", () => {
    const line = describeActions(
      [
        act("move", "logged", "ai_info"),
        act("move", "applied", "ai_info"),
        act("flag", "applied"),
        delegation("ready", "d1"),
        act("mark_read", "failed"),
        { ...send("approved"), waiting: "send_limit" },
      ],
      jan,
      {},
      PL
    );
    expect(line).toContain("zrobi – ");
    expect(line).toContain("zrobione – ");
    expect(line).toContain("nieudane – ");
    expect(line).toContain("(wykonawca Jan)");
    expect(line).toContain("zatwierdzone, czeka (limit wysyłki)");
    expect(line.match(/:(?=\s|$)/g) ?? []).toHaveLength(0);
  });
});
