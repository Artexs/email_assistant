import { noticePath, pushPayloadSchema, pushTexts, type PushPayload } from "@ea/core/push";

// The service worker of the panel. It caches the app shell only: `/offline.html` and the hashed files of `/_astro/`. It never
// answers an `/api` request and never stores a page: a page holds mail data, so a navigation always goes to the network. The worker
// shows a push (kind and count, no mail text) and opens the page of its kind on a tap.
// The logic here is pure or takes the scope as an argument, so a unit test runs it without a browser. `sw/sw.ts` wires it to `self`.

/** The format of the cache name. The build adds a hash of the cached files (`shell-precache.ts`): `activate` deletes the other caches. */
export const SW_VERSION = "v2";
export const SHELL_CACHE_PREFIX = "ea-shell-";
export const OFFLINE_PATH = "/offline.html";
/** The page that a tap opens when the notification holds no valid path. */
export const FALLBACK_PATH = "/activity";

export type FetchRule = "cache-first" | "network-with-offline-page" | "not-handled";

export interface RequestFacts {
  method: string;
  url: string;
  /** `Request.mode`: only `navigate` is a page load. */
  mode: string;
}

// One rule for every request. `/api` comes first: nothing below can reach it. A request that is not a GET, or that goes to another origin,
// is not handled either. `respondWith` is called only for the other two rules.
export function fetchRule(request: RequestFacts, origin: string): FetchRule {
  if (request.method !== "GET") return "not-handled";
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return "not-handled";
  }
  if (url.origin !== origin) return "not-handled";
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return "not-handled";
  if (url.pathname.startsWith("/_astro/")) return "cache-first";
  if (request.mode === "navigate") return "network-with-offline-page";
  return "not-handled";
}

/** The caches that `activate` deletes: ours from another version. A cache of another owner is never touched. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== current);
}

export interface PushNotification {
  title: string;
  options: { body: string; tag: string; data: { path: string } };
}

// The notification of one push. The text is `unknown`: anything that is not a valid payload shows nothing.
export function notificationOf(raw: unknown): PushNotification | null {
  const parsed = pushPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const payload: PushPayload = parsed.data;
  const texts = pushTexts(payload.lang);
  return {
    title: texts.title(payload.kind),
    options: {
      body: texts.body(payload.kind, payload.count),
      tag: payload.id,
      data: { path: noticePath(payload.kind, payload.itemId) },
    },
  };
}

// The path of a tap. The data was set by `notificationOf`, but a notification outlives the worker version: anything that is not a
// path on this origin (one slash first, no `//`, no `\`) falls back to the Activity page.
export function clickPath(data: unknown): string {
  const path = typeof data === "object" && data !== null ? (data as { path?: unknown }).path : undefined;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return FALLBACK_PATH;
  }
  return path;
}

// What the browser gives the worker. Only the parts that are used: the real types need the `webworker` lib, which clashes with `dom`.
export interface WorkerWindow {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}
interface WorkerEvent {
  waitUntil(work: Promise<unknown>): void;
}
export interface FetchEventLike extends WorkerEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
export interface PushEventLike extends WorkerEvent {
  data: { json(): unknown } | null;
}
export interface ClickEventLike extends WorkerEvent {
  notification: { close(): void; data: unknown };
}
export interface WorkerScope {
  location: { origin: string };
  caches: Pick<CacheStorage, "open" | "keys" | "delete" | "match">;
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<readonly WorkerWindow[]>;
    openWindow(url: string): Promise<unknown>;
    claim(): Promise<void>;
  };
  registration: { showNotification(title: string, options: PushNotification["options"]): Promise<void> };
  addEventListener(type: string, listener: (event: never) => void): void;
}

/** What the build puts into the worker: the files of the offline page and the hash of their bytes. */
export interface ShellFiles {
  assets: readonly string[];
  version: string;
}

// The install stores the offline page and every file it needs, so the page keeps its look with no network. A file that fails makes the
// install fail: the old worker stays.
export function installWorker(scope: WorkerScope, shell: ShellFiles): void {
  const origin = scope.location.origin;
  const cacheName = `${SHELL_CACHE_PREFIX}${shell.version}`;

  scope.addEventListener("install", ((event: WorkerEvent) => {
    event.waitUntil(scope.caches.open(cacheName).then((cache) => cache.addAll([OFFLINE_PATH, ...shell.assets])));
  }) as (event: never) => void);

  scope.addEventListener("activate", ((event: WorkerEvent) => {
    event.waitUntil(
      scope.caches
        .keys()
        .then((names) => Promise.all(staleCaches(names, cacheName).map((name) => scope.caches.delete(name))))
        .then(() => scope.clients.claim())
    );
  }) as (event: never) => void);

  scope.addEventListener("fetch", ((event: FetchEventLike) => {
    const rule = fetchRule(event.request, origin);
    if (rule === "not-handled") return;
    if (rule === "cache-first") {
      event.respondWith(cacheFirst(scope, cacheName, event.request));
      return;
    }
    // A page: always from the network. Only a network error shows the offline page; a 4xx or 5xx answer passes through.
    event.respondWith(
      fetch(event.request).catch(async () => (await scope.caches.match(OFFLINE_PATH)) ?? Response.error())
    );
  }) as (event: never) => void);

  scope.addEventListener("push", ((event: PushEventLike) => {
    let raw: unknown = null;
    try {
      raw = event.data?.json() ?? null;
    } catch {
      raw = null;
    }
    const notification = notificationOf(raw);
    if (notification === null) return;
    event.waitUntil(scope.registration.showNotification(notification.title, notification.options));
  }) as (event: never) => void);

  scope.addEventListener("notificationclick", ((event: ClickEventLike) => {
    event.notification.close();
    const path = clickPath(event.notification.data);
    event.waitUntil(openPanel(scope, path));
  }) as (event: never) => void);
}

// A hashed file never changes, so a stored answer is final. Only a complete 200 answer is stored.
async function cacheFirst(scope: WorkerScope, cacheName: string, request: Request): Promise<Response> {
  const cache = await scope.caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

async function openPanel(scope: WorkerScope, path: string): Promise<void> {
  const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((window) => new URL(window.url).origin === scope.location.origin);
  if (open) {
    await open.focus();
    if (open.navigate) {
      await open.navigate(path);
      return;
    }
  }
  await scope.clients.openWindow(path);
}
