import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
let org: WebOrg;
let dist = "";

beforeAll(async () => {
  org = await webOrg(db);
  dist = mkdtempSync(join(tmpdir(), "ea-operator-dist-"));
  for (const dir of ["operator", "settings"]) mkdirSync(join(dist, dir));
  writeFileSync(join(dist, "404.html"), "not found page");
  writeFileSync(join(dist, "operator/index.html"), "operator page");
  writeFileSync(join(dist, "settings/index.html"), "settings page");
});

afterAll(async () => {
  rmSync(dist, { recursive: true, force: true });
  await org.cleanup();
  await db.destroy();
});

const app = () =>
  webTestApp({
    db,
    dist,
    routers: () => undefined,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    operatorUserIds: new Set([org.assistantId]),
  });

// Every form of the path that a client can send for the operator page.
const FORMS = [
  "/operator",
  "/operator/",
  "/operator/index.html",
  "/%6Fperator",
  "/%6fperator/",
  "/OPERATOR",
  "/./operator",
  "/settings/../operator",
  "/operator/index%2Ehtml",
];

describe("the operator console page (F099 stage 06, D22)", () => {
  test("1. a non-operator gets the 404 page in every path form", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      for (const path of FORMS) {
        const res = await app().request(path, as("owner"));
        expect({ path, status: res.status, body: await res.text(), cache: res.headers.get("cache-control") }).toEqual({
          path,
          status: 404,
          body: "not found page",
          cache: "private, no-store",
        });
      }
      const lines = errorSpy.mock.calls
        .map((call) => call.join(" "))
        .filter((l) => l.includes("operator_page_refused"));
      expect(lines.length).toBe(FORMS.length);
      for (const line of lines) {
        expect(line).toContain(`user_id=${org.ownerId}`);
        expect(line).not.toContain("@x.test");
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("2. the operator gets the page", async () => {
    for (const path of ["/operator", "/operator/", "/operator/index.html"]) {
      const res = await app().request(path, as("assistant"));
      expect({ path, status: res.status, body: await res.text() }).toEqual({
        path,
        status: 200,
        body: "operator page",
      });
    }
  });

  test("3. no session redirects to the login page", async () => {
    const res = await app().request("/operator");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?next=%2Foperator");
  });

  test("4. the guard does not leak: the owner still reads /settings", async () => {
    const res = await app().request("/settings", as("owner"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("settings page");
  });

  test("a web without operatorUserIds refuses the operator user too", async () => {
    const bare = webTestApp({ db, dist, routers: () => undefined, sessions: { assistant: org.assistantId } });
    expect((await bare.request("/operator", as("assistant"))).status).toBe(404);
  });
});
