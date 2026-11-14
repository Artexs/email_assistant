import { describe, expect, test } from "bun:test";

import { mailboxStatuses } from "@ea/core/web";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";

import { mailboxStatusUi } from "./mailbox-status";

describe("mailboxStatusUi", () => {
  test("has one entry per status of core", () => {
    expect(Object.keys(mailboxStatusUi).sort()).toEqual([...mailboxStatuses].sort());
  });

  test("host_blocked is a destructive badge with an owner hint", () => {
    expect(mailboxStatusUi.host_blocked).toEqual({
      variant: "destructive",
      text: "status_host_blocked",
      hint: "mb_host_blocked_hint",
    });
    expect(en[mailboxStatusUi.host_blocked.text]).toBe("Server not allowed");
    expect(pl[mailboxStatusUi.host_blocked.text]).toBe("Serwer niedozwolony");
  });

  test("auth_error keeps its hint; active and paused have none", () => {
    expect(mailboxStatusUi.auth_error.hint).toBe("mb_auth_error_hint");
    expect(mailboxStatusUi.active.hint).toBeNull();
    expect(mailboxStatusUi.paused.hint).toBeNull();
  });
});
