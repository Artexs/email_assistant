import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { generateVapidKeyPair } from "../../../server/src/platform/vapid-keys";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { e2eEnv, E2E_BASE_URL, repoRoot } from "../env";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The push device card of Settings, with a fake `PushManager`: no browser push service and no network push. The server keeps its real
// routes and its real store; only the browser object is a fake, and the test notice answer is a stub (the real route would call a
// push service). The flag `web_push` is on for the seed organization only while this file runs.
test.describe.configure({ mode: "serial" });

function setFlag(enabled: boolean): void {
  const { orgId } = readSeed();
  execFileSync(
    "bun",
    ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", "web_push", enabled ? "--on" : "--off"],
    { cwd: repoRoot, env: e2eEnv(), stdio: "pipe" }
  );
}

const onMobile = (): boolean => test.info().project.name === "mobile";
let errors: string[] = [];

interface PushBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  rebindOnly?: boolean;
}

interface Fake {
  endpoint: string;
  puts: PushBody[];
  deletes: string[];
}

// The fake lives in the page: it replaces `pushManager` of every registration. The subscription survives a reload (local storage), so
// the load-time re-bind has one to send. The keys are a real P-256 point and 16 random bytes in unpadded base64url.
async function installFake(page: Page, permission: "default" | "denied"): Promise<Fake> {
  const fake: Fake = { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`, puts: [], deletes: [] };
  const keys = {
    p256dh: generateVapidKeyPair().publicKey,
    auth: randomBytes(16).toString("base64url"),
    endpoint: fake.endpoint,
  };
  await page.addInitScript(
    ({ p256dh, auth, endpoint, state }) => {
      const stateKey = "e2e-push-subscription";
      const permissionKey = "e2e-push-permission";
      const bytesOf = (text: string): ArrayBuffer => {
        const standard = text.replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
        return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
      };
      const made = (): object => ({
        endpoint,
        options: { applicationServerKey: null },
        getKey: (name: string) => bytesOf(name === "p256dh" ? p256dh : auth),
        unsubscribe: () => {
          localStorage.removeItem(stateKey);
          return Promise.resolve(true);
        },
      });
      const calls = { subscribe: [] as number[][], asked: 0 };
      (window as unknown as { __pushCalls: typeof calls }).__pushCalls = calls;
      const manager = {
        getSubscription: () => Promise.resolve(localStorage.getItem(stateKey) === null ? null : made()),
        subscribe: (options: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer }) => {
          calls.subscribe.push([...new Uint8Array(options.applicationServerKey)]);
          localStorage.setItem(stateKey, "yes");
          return Promise.resolve(made());
        },
      };
      Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
        configurable: true,
        get: () => manager,
      });
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => localStorage.getItem(permissionKey) ?? state,
      });
      Notification.requestPermission = () => {
        calls.asked += 1;
        localStorage.setItem(permissionKey, "granted");
        return Promise.resolve("granted");
      };
    },
    { ...keys, state: permission }
  );
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/me/push/subscription" && request.method() === "PUT") {
      fake.puts.push(request.postDataJSON() as PushBody);
    }
    if (path.startsWith("/api/me/push/devices/") && request.method() === "DELETE") fake.deletes.push(path);
  });
  return fake;
}

const callsOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pushCalls: { subscribe: number[][]; asked: number } }).__pushCalls);

// The public key as the server answers it, in bytes.
async function serverKeyBytes(page: Page): Promise<number[]> {
  const state = (await (await page.request.get("/api/me/push")).json()) as { vapidPublicKey: string };
  return [...Buffer.from(state.vapidPublicKey, "base64url")];
}

test.beforeAll(() => setFlag(false));
test.afterAll(() => setFlag(false));

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(onMobile() ? 65 : 165) });
  errors = await cspErrors(page);
});

test.afterEach(async ({ page }) => {
  // Devices of the seed user stay in the store: remove them, and put the flag back.
  const list = await page.request.get("/api/me/push");
  if (list.ok()) {
    for (const device of ((await list.json()) as { devices: { id: string }[] }).devices) {
      await page.request.delete(`/api/me/push/devices/${device.id}`, { headers: { origin: E2E_BASE_URL } });
    }
  }
  setFlag(false);
  expect(errors).toEqual([]);
});

test("flag off: no card and no re-bind request, even with a subscription in the browser", async ({ page }) => {
  const fake = await installFake(page, "default");
  await page.addInitScript(() => {
    localStorage.setItem("e2e-push-subscription", "yes");
    localStorage.setItem("e2e-push-permission", "granted");
  });
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/settings");
  await expect(page.getByRole("region", { name: en.set_group_notices })).toBeVisible();
  await expect(page.locator("[data-card=push-devices]")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(fake.puts).toEqual([]);
  expect((await page.request.get("/api/me/push")).status()).toBe(404);
});

test("flag on: turn on notices, test notice, re-bind on load, remove", async ({ page }) => {
  setFlag(true);
  const fake = await installFake(page, "default");
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/settings");
  const card = page.locator("[data-card=push-devices]");
  await expect(card).toBeVisible();
  await expect(card.getByText(en.push_no_devices)).toBeVisible();
  await expect(card.getByRole("button", { name: en.push_test })).toHaveCount(0);
  await expectNoA11yViolations(page, { include: "[data-card=push-devices]" });

  // The click: permission question, subscribe with the PUBLIC key of the server, PUT without padding and without `rebindOnly`.
  await card.getByRole("button", { name: en.push_enable }).click();
  await expect(page.getByText(en.push_enabled_toast)).toBeVisible();
  const calls = await callsOf(page);
  expect(calls.asked).toBe(1);
  expect(calls.subscribe).toEqual([await serverKeyBytes(page)]);
  expect(fake.puts).toHaveLength(1);
  const [put] = fake.puts;
  expect(put?.endpoint).toBe(fake.endpoint);
  expect(put?.rebindOnly).toBeUndefined();
  expect(`${put?.keys.p256dh}${put?.keys.auth}`).not.toMatch(/[=+/]/);

  const row = card.locator("[data-device]");
  await expect(row).toHaveCount(1);
  await expect(row.getByText(en.acct_this_device)).toBeVisible();
  await expect(row.getByText(en.push_never)).toBeVisible();
  await expect(card.getByRole("button", { name: en.push_enable })).toHaveCount(0);
  await expectNoA11yViolations(page, { include: "[data-card=push-devices]" });

  // The test notice: the answer is a stub (the real route would call a push service).
  let tested = 0;
  await page.route("**/api/me/push/test", (route) => {
    tested += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: 1 }) });
  });
  await card.getByRole("button", { name: en.push_test }).click();
  await expect(page.getByText("Test notice sent to 1 device.")).toBeVisible();
  expect(tested).toBe(1);

  // A new page load of the same session: the subscription is sent again, with `rebindOnly`, and no second device appears.
  fake.puts.length = 0;
  await page.reload();
  await expect(page.locator("[data-card=push-devices] [data-device]")).toHaveCount(1);
  await expect.poll(() => fake.puts.length).toBe(1);
  expect(fake.puts[0]?.rebindOnly).toBe(true);
  expect((await callsOf(page)).subscribe).toEqual([]);

  // Remove: a confirm step first, then the delete.
  const again = page.locator("[data-card=push-devices]");
  await again.locator("[data-device]").getByRole("button", { name: en.push_remove_short }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.push_remove_title)).toBeVisible();
  expect(fake.deletes).toEqual([]);
  await dialog.getByRole("button", { name: en.push_remove_confirm }).click();
  await expect(again.getByText(en.push_no_devices)).toBeVisible();
  expect(fake.deletes).toHaveLength(1);
});

test("blocked permission: the text, no button, no subscription and no request", async ({ page }) => {
  setFlag(true);
  const fake = await installFake(page, "denied");
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/settings");
  const card = page.locator("[data-card=push-devices]");
  await expect(card.getByText(en.push_blocked)).toBeVisible();
  await expect(card.getByRole("button", { name: en.push_enable })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect((await callsOf(page)).subscribe).toEqual([]);
  expect(fake.puts).toEqual([]);
  await expectNoA11yViolations(page, { include: "[data-card=push-devices]" });
});
