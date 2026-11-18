import { describe, expect, test } from "bun:test";

import { checkPushEndpoint, MAX_ENDPOINT_LENGTH } from "./endpoint";

describe("checkPushEndpoint", () => {
  test("6a. the push services of the browser vendors are ok", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/x",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
      "https://fcm.googleapis.com:443/fcm/send/x",
      "https://FCM.GoogleAPIs.com/fcm/send/x",
    ])
      expect({ url, check: checkPushEndpoint(url) }).toEqual({ url, check: { ok: true } });
  });

  test("6b. a bad scheme, port or user info is bad_endpoint; another host is push_host_not_allowed", () => {
    const code = (url: string): string => {
      const check = checkPushEndpoint(url);
      return check.ok ? "ok" : check.code;
    };
    expect(code("http://fcm.googleapis.com/x")).toBe("bad_endpoint");
    expect(code("https://fcm.googleapis.com:8443/x")).toBe("bad_endpoint");
    expect(code("https://u:p@fcm.googleapis.com/x")).toBe("bad_endpoint");
    expect(code("https://u@fcm.googleapis.com/x")).toBe("bad_endpoint");
    expect(code("not a url")).toBe("bad_endpoint");
    expect(code("")).toBe("bad_endpoint");
    expect(code("//fcm.googleapis.com/x")).toBe("bad_endpoint");
    expect(code(`https://fcm.googleapis.com/${"a".repeat(MAX_ENDPOINT_LENGTH)}`)).toBe("bad_endpoint");
    expect(code("https://evilfcm.googleapis.com.example.org/x")).toBe("push_host_not_allowed");
    expect(code("https://evilfcm.googleapis.com/x")).toBe("push_host_not_allowed");
    expect(code("https://notfcm.googleapis.com/x")).toBe("push_host_not_allowed");
    expect(code("https://fcm.googleapis.com.evil.org/x")).toBe("push_host_not_allowed");
    expect(code("https://fcm.googleapis.com./x")).toBe("push_host_not_allowed");
    expect(code("https://127.0.0.1/x")).toBe("push_host_not_allowed");
    expect(code("https://[::1]/x")).toBe("push_host_not_allowed");
    expect(code("https://localhost/x")).toBe("push_host_not_allowed");
    expect(code("https://example.com/push.apple.com")).toBe("push_host_not_allowed");
    expect(code("https://example.com/?x=fcm.googleapis.com")).toBe("push_host_not_allowed");
    expect(code("https://fcm.googleapis.com@127.0.0.1/x")).toBe("bad_endpoint");
    expect(code("https://127.0.0.1#@fcm.googleapis.com/x")).toBe("push_host_not_allowed");
    // The WHATWG parser reads `\` as a path separator: the host is fcm.googleapis.com, and fetch uses the same parser.
    expect(code("https://fcm.googleapis.com\\@evil.org/x")).toBe("ok");
    expect(code("https://evil.org\\@fcm.googleapis.com/x")).toBe("push_host_not_allowed");
  });
});
