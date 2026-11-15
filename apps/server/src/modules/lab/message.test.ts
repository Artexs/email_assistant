import { LAB_FAKE_TELEGRAM_TOKEN, parseLabMessageId, planLiveRun, toLabMessage, type Slot } from "@ea/core";
import { FAKE_TOKEN } from "@ea/fake-telegram";
import { describe, expect, test } from "bun:test";

import { corpusDir, readScenario, readSlots, readTexts } from "../../scripts/sim-files";
import { isSyntheticMessageId } from "../mail";

import { renderLabMessage } from "./message";

const RUN = "week-20261123-a1b2";
const MAILBOX = "wiktor.szalewski@kordelan.test";

describe("lab messages of the frozen week", () => {
  const dir = corpusDir("lab-01");
  const scenario = readScenario(dir);
  const slots = readSlots(dir, "week");
  const texts = readTexts(dir, "week");
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const plan = planLiveRun({ scenario, slots, mode: "week", startDate: "2026-11-23", runId: RUN });
  if ("refused" in plan) throw new Error(`plan refused: ${plan.refused}`);

  function chainOf(slot: Slot): Slot[] {
    const chain: Slot[] = [];
    for (let parentId = slot.parentId; parentId !== undefined; ) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error(`parent of ${slot.id} is missing`);
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    return chain;
  }

  test("5 all 855 week slots map and render; each rendered id parses back to its slot", () => {
    expect(slots).toHaveLength(855);
    for (const slot of slots) {
      const text = texts.get(slot.id);
      if (!text) throw new Error(`no text for ${slot.id}`);
      const message = toLabMessage({ slot, text, scenario, plan, mailbox: MAILBOX, parents: chainOf(slot) });
      const raw = renderLabMessage(message);
      const header = /^Message-ID: (.*)$/m.exec(raw)?.[1];
      expect(header).toBe(message.messageId);
      expect(isSyntheticMessageId(message.messageId)).toBe(false);
      expect(parseLabMessageId(header as string)).toEqual({ slotId: slot.id, runId: RUN });
      expect(message.kind).toBe(slot.direction === "sent" ? "append_sent" : "smtp");
    }
  });

  test("a threaded slot renders In-Reply-To and References, root first", () => {
    const slot = slots.find((candidate) => chainOf(candidate).length >= 2);
    if (!slot) throw new Error("no slot with a 2-deep chain");
    const chain = chainOf(slot);
    const message = toLabMessage({
      slot,
      text: texts.get(slot.id) as NonNullable<ReturnType<typeof texts.get>>,
      scenario,
      plan,
      mailbox: MAILBOX,
      parents: chain,
    });
    const raw = renderLabMessage(message);
    expect(message.references).toHaveLength(chain.length);
    expect(raw).toContain(`In-Reply-To: ${message.references.at(-1)}`);
    expect(raw).toContain(`References: ${message.references.join(" ")}`);
    expect(parseLabMessageId(message.references[0] as string)?.slotId).toBe(chain[0]?.id);
  });
});

describe("LAB_FAKE_TELEGRAM_TOKEN", () => {
  test("8 equals the default token of the fake Telegram", () => {
    expect(LAB_FAKE_TELEGRAM_TOKEN).toBe(FAKE_TOKEN);
  });
});
