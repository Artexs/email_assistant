import { beforeEach, describe, expect, test } from "bun:test";

import { setLocaleForTest } from "../i18n";

import {
  currentRouteOf,
  hasNoChannel,
  routeOptionsOf,
  routesPatchOf,
  routesResetOf,
  type RouteValue,
} from "./notice-routes";

type View = Parameters<typeof routesPatchOf>[0] & { telegramLinked: boolean };

const channels = (telegram: boolean, push: boolean) => ({ telegram, push });
const view = (over: Partial<View> = {}): View => ({
  routes: {},
  routeDefaults: {
    urgent: channels(true, true),
    approvals: channels(true, true),
    updates: channels(true, false),
  },
  telegramLinked: true,
  ...over,
});
const shown = (v: View, group: "urgent" | "approvals" | "updates"): string | undefined =>
  routeOptionsOf(v, group).find((option) => option.value === currentRouteOf(v, group))?.label;

beforeEach(() => setLocaleForTest("en"));

describe("the notice route select model", () => {
  test("a group with no stored choice shows the default, marked; a stored choice shows its own word", () => {
    expect(shown(view(), "urgent")).toBe("Both (default)");
    expect(shown(view(), "updates")).toBe("Telegram (default)");
    expect(shown(view({ routes: { urgent: "push" } }), "urgent")).toBe("Phone");
    // The default mark stays on the default option, also while another option is stored.
    expect(routeOptionsOf(view({ routes: { urgent: "push" } }), "urgent").map((option) => option.label)).toEqual([
      "Telegram",
      "Phone",
      "Both (default)",
    ]);
  });

  test("the default follows the channels that exist: a member with a device and no chat gets Phone", () => {
    const phoneOnly = view({
      telegramLinked: false,
      routeDefaults: {
        urgent: channels(false, true),
        approvals: channels(false, true),
        updates: channels(false, true),
      },
    });
    expect(shown(phoneOnly, "urgent")).toBe("Phone (default)");
    expect(hasNoChannel(phoneOnly)).toBe(false);
  });

  test("the labels are Polish in the Polish panel", () => {
    setLocaleForTest("pl");
    expect(shown(view(), "urgent")).toBe("Oba (domyślnie)");
    expect(shown(view({ routes: { urgent: "push" } }), "urgent")).toBe("Telefon");
  });

  test("an untouched select sends nothing; a touched one sends its own key only", () => {
    expect(routesPatchOf(view(), {})).toBeNull();
    expect(routesPatchOf(view(), { urgent: "push" })).toEqual({ urgent: "push" });
    expect(routesPatchOf(view(), { urgent: "push", updates: "both" })).toEqual({ urgent: "push", updates: "both" });
  });

  test("a change back to what the select showed sends nothing", () => {
    expect(routesPatchOf(view(), { urgent: "both" })).toBeNull();
    expect(routesPatchOf(view({ routes: { urgent: "push" } }), { urgent: "push" })).toBeNull();
    const back: RouteValue = "telegram";
    expect(routesPatchOf(view({ routes: { updates: back } }), { updates: back })).toBeNull();
  });

  test("the reset body names the stored groups only", () => {
    expect(routesResetOf(view())).toBeNull();
    expect(routesResetOf(view({ routes: { urgent: "push", updates: "both" } }))).toEqual({
      urgent: null,
      updates: null,
    });
  });

  test("no chat and no device is the hint case; a chat alone is not", () => {
    const none = view({
      telegramLinked: false,
      routeDefaults: {
        urgent: channels(false, false),
        approvals: channels(false, false),
        updates: channels(false, false),
      },
    });
    expect(hasNoChannel(none)).toBe(true);
    expect(hasNoChannel(view())).toBe(false);
    expect(hasNoChannel({ ...none, telegramLinked: true })).toBe(false);
  });
});
