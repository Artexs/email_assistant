import { describe, expect, test } from "bun:test";

import type { ActionType, FolderKey } from "../triage/planners";

import { type ActionView, describeActions } from "./would-do";

function act(type: ActionType, status: string, folder: FolderKey | null = null, reverse = false): ActionView {
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
    ["move without folder", [act("move", "logged")], "would move"],
    ["undone original", [act("move", "undone", "ai_info")], "undone: move to AI/Info"],
    [
      "reverse row is skipped",
      [act("move", "undone", "ai_info"), act("move", "applied", "ai_info", true)],
      "undone: move to AI/Info",
    ],
    ["rejected is left out", [act("flag", "rejected")], "stays in INBOX"],
  ])("%s", (_name, actions, expected) => {
    expect(describeActions(actions)).toBe(expected);
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
    expect(describeActions([draft(status)], names)).toBe(expected);
  });

  test("the phrase by kind and the name fallback", () => {
    expect(describeActions([draft("ready", "clarification")], names)).toBe("will draft a question to the sender");
    expect(describeActions([draft("ready", "reminder")], names)).toBe("will draft a reminder to Anna Nowak");
    expect(describeActions([draft("ready")])).toBe("will draft a delegation to a delegate");
    expect(describeActions([draft("ready")], new Map())).toBe("will draft a delegation to a delegate");
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
    expect(describeActions([send(status)], names)).toBe(expected);
  });

  test("a draft and a send join with a semicolon", () => {
    expect(describeActions([draft("ready"), send("awaiting_approval")], names)).toBe(
      "will draft a delegation to Anna Nowak; waits for your approval"
    );
  });

  test("an undone draft plus an applied send reads from the send", () => {
    expect(describeActions([draft("undone"), send("applied")], names)).toBe("sent");
  });

  test("a reverse draft row is skipped", () => {
    expect(describeActions([draft("applied"), draft("ready", "delegation", true), send("applied")], names)).toBe(
      "done: draft a delegation to Anna Nowak; sent"
    );
  });

  test("two sends with the same phrase print it once", () => {
    expect(describeActions([send("applied"), send("applied")], names)).toBe("sent");
    expect(describeActions([draft("undone"), send("applied"), send("applied")], names)).toBe("sent");
  });
});
