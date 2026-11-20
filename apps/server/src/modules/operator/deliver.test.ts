import { describe, expect, test } from "bun:test";

import { createOperatorDelivery } from "./deliver";

// The one delivery of the operator texts: the log lines of each outcome, and one failure line per alert key.
interface LogLine {
  level: "info" | "warn" | "error";
  event: string;
  fields: Record<string, unknown>;
}

function harness(send: ((text: string) => Promise<void>) | null) {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine["level"]) =>
    (event: string, fields?: Record<string, unknown>): void => {
      lines.push({ level, event, fields: fields ?? {} });
    };
  const delivery = createOperatorDelivery({ send, log: { info: at("info"), warn: at("warn"), error: at("error") } });
  return { delivery, lines };
}

const failing = (): Promise<void> => Promise.reject(new Error("telegram down: SECRET-TEXT-1 chat 123"));

describe("createOperatorDelivery", () => {
  test("a send that resolves returns true and logs one info line", async () => {
    const h = harness(() => Promise.resolve());
    expect(await h.delivery.deliver({ kind: "slo_disk", status: "open", key: "K" }, "text")).toBe(true);
    expect(h.lines).toEqual([
      { level: "info", event: "operator_alert_sent", fields: { kind: "slo_disk", status: "open" } },
    ]);
  });

  test("no send counts as delivered and logs one warn line", async () => {
    const h = harness(null);
    expect(await h.delivery.deliver({ kind: "llm_cap", status: "open", key: "K" }, "text")).toBe(true);
    expect(h.lines).toEqual([
      { level: "warn", event: "operator_alert_unsent", fields: { kind: "llm_cap", status: "open" } },
    ]);
  });

  test("a send that throws twice for one key returns false twice and logs one error line", async () => {
    const h = harness(failing);
    const alert = { kind: "send_limit", status: "open", key: "K" } as const;
    expect(await h.delivery.deliver(alert, "text")).toBe(false);
    expect(await h.delivery.deliver(alert, "text")).toBe(false);
    expect(h.lines).toEqual([
      {
        level: "error",
        event: "operator_alert_send_failed",
        fields: { kind: "send_limit", status: "open", error: "Error" },
      },
    ]);
  });

  test("a send that throws for two keys logs one error line for each", async () => {
    const h = harness(failing);
    await h.delivery.deliver({ kind: "slo_disk", status: "open", key: "K" }, "text");
    await h.delivery.deliver({ kind: "slo_disk", status: "repeat", key: "K2" }, "text");
    expect(h.lines.map((line) => [line.event, line.fields.status])).toEqual([
      ["operator_alert_send_failed", "open"],
      ["operator_alert_send_failed", "repeat"],
    ]);
  });

  test("the text and the error message reach no logged field", async () => {
    const sent = harness(() => Promise.resolve());
    const failed = harness(failing);
    await sent.delivery.deliver({ kind: "slo_disk", status: "open", key: "K" }, "SECRET-TEXT-1");
    await failed.delivery.deliver({ kind: "slo_disk", status: "open", key: "K" }, "SECRET-TEXT-1");
    expect(JSON.stringify([...sent.lines, ...failed.lines])).not.toContain("SECRET");
  });
});
