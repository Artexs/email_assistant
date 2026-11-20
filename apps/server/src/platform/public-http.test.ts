import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import { createServer as createTcpServer, type Socket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { LookupAll } from "./net-address";
import {
  isPublicAddress,
  MAX_RESPONSE_BYTES,
  ONE_CLICK_BODY,
  ONE_CLICK_USER_AGENT,
  postOneClick,
  readTarget,
  sendPinned,
  type Dial,
  type DialRequest,
} from "./public-http";

// The guarded one-click client. No test calls a real host: every request goes to a server on 127.0.0.1 that
// the test starts, through the `dial` seam (the guard still runs and sees a public test address). The certificate of the local
// server is made by `openssl` into a temporary folder in `beforeAll`; no key is committed.

const HOST = "news.example.test";
const PUBLIC = "93.184.216.34"; // the address that a test lookup gives: public, so the guard accepts it

const lookupOf =
  (...addresses: string[]): LookupAll =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

let folder = "";
let cert = "";
let key = "";

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "public-http-"));
  const made = spawnSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2"],
      ...["-keyout", join(folder, "k.pem"), "-out", join(folder, "c.pem")],
      ...["-subj", `/CN=${HOST}`, "-addext", `subjectAltName=DNS:${HOST}`],
    ],
    { encoding: "utf8" }
  );
  if (made.status !== 0) throw new Error("openssl failed to make the test certificate");
  cert = readFileSync(join(folder, "c.pem"), "utf8");
  key = readFileSync(join(folder, "k.pem"), "utf8");
});
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

interface Seen {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  rawHeaderNames: string[];
  body: string;
  servername: string | undefined;
}

interface Local {
  server: Server;
  port: number;
  seen: Seen[];
  close(): void;
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
  listenHost = "127.0.0.1"
): Promise<Local> {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const server = createServer({ key, cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawHeaderNames: req.rawHeaders.filter((_, index) => index % 2 === 0).map((name) => name.toLowerCase()),
        body,
        servername: (req.socket as unknown as { servername?: string }).servername,
      });
      handler(req, res, body);
    });
  });
  server.on("connection", (duplex) => {
    const socket = duplex as Socket;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, listenHost, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    port,
    seen,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

// The test seam: the real `sendPinned` against the local server, with the local certificate as the only trusted one.
const viaLoopback =
  (local: Local, dialed: DialRequest[] = []): Dial =>
  (request) => {
    dialed.push(request);
    return sendPinned({ ...request, address: "127.0.0.1" }, { port: local.port, ca: cert });
  };

const url = (text: string) => new URL(text);

describe("readTarget (the URL part of the guard)", () => {
  test("1. a public https name with the default port is accepted; only the parsed path and query are used", () => {
    expect(readTarget(url("https://news.example.com/u/42?t=a%20b#frag"))).toEqual({
      ok: true,
      hostname: "news.example.com",
      path: "/u/42?t=a%20b",
    });
    expect(readTarget(url("https://NEWS.Example.com:443/"))).toEqual({
      ok: true,
      hostname: "news.example.com",
      path: "/",
    });
  });

  test("2. every other scheme is refused: scheme", () => {
    for (const text of ["http://news.example.com/", "ftp://news.example.com/", "mailto:a@example.com", "javascript:1"])
      expect({ text, result: readTarget(url(text)) }).toEqual({ text, result: { ok: false, code: "scheme" } });
  });

  test("3. a user name or a password is refused: userinfo", () => {
    for (const text of [
      "https://user@news.example.com/",
      "https://user:pw@news.example.com/",
      "https://:pw@news.example.com/",
    ])
      expect({ text, result: readTarget(url(text)) }).toEqual({ text, result: { ok: false, code: "userinfo" } });
  });

  test("4. any port except 443 is refused: port", () => {
    for (const text of [
      "https://news.example.com:8443/",
      "https://news.example.com:80/",
      "https://news.example.com:6379/",
    ])
      expect({ text, result: readTarget(url(text)) }).toEqual({ text, result: { ok: false, code: "port" } });
  });

  test("5. an IP literal in any spelling is refused before any lookup: decimal, octal, hex, short, mapped IPv6", () => {
    const literals = [
      "https://127.0.0.1/",
      "https://2130706433/", // decimal
      "https://0177.0.0.1/", // octal
      "https://0x7f.0.0.1/", // hex
      "https://0x7f000001/",
      "https://127.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/",
      "https://[::]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:7f00:1]/",
      "https://[fd00:ec2::254]/",
      "https://[2606:4700::1111]/", // a public literal is refused too
      "https://8.8.8.8/",
      "https://127。0。0。1/", // ideographic full stops
      "https://%31%32%37.0.0.1/",
    ];
    for (const text of literals)
      expect({ text, result: readTarget(url(text)) }).toEqual({ text, result: { ok: false, code: "private_host" } });
  });

  test("6. a host that is not a plain public name is refused: host", () => {
    for (const text of [
      "https://localhost/",
      "https://ＬＯＣＡＬＨＯＳＴ/", // full-width letters become `localhost`
      "https://intranet/",
      "https://news.example.com./", // a trailing dot
      "https://printer.local/",
      "https://metadata.internal/",
      "https://something.localhost/",
      "https://router.lan/",
      "https://example.onion/",
    ])
      expect({ text, result: readTarget(url(text)) }).toEqual({ text, result: { ok: false, code: "host" } });
  });

  test("7. an IDN name is checked in its punycode form; a name that stays non-ASCII cannot pass", () => {
    expect(readTarget(url("https://münchen.example/"))).toEqual({
      ok: true,
      hostname: "xn--mnchen-3ya.example",
      path: "/",
    });
    // The backslash ends the host in the WHATWG parser: the target is `news.example.com`, never `127.0.0.1`.
    expect(readTarget(url("https://news.example.com\\@127.0.0.1/"))).toEqual({
      ok: true,
      hostname: "news.example.com",
      path: "/@127.0.0.1/",
    });
  });
});

describe("isPublicAddress (the address part of the guard)", () => {
  test("8. every private, local, metadata, multicast, unspecified and reserved address is refused", () => {
    const refused = [
      "127.0.0.1",
      "127.255.255.254",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "169.254.0.1",
      "100.64.0.1",
      "100.100.100.200", // Alibaba metadata
      "168.63.129.16", // Azure wire server
      "192.0.2.1",
      "198.51.100.7",
      "203.0.113.9",
      "198.18.0.1",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:8.8.8.8", // an IPv4-mapped address is refused whatever it embeds
      "::127.0.0.1",
      "fe80::1",
      "fc00::1",
      "fd00:ec2::254", // AWS IPv6 metadata
      "ff02::1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "2001:db8::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
      "100::1",
      // NOTE 3: the protocol block 2001::/23 is not global, except the registry entries (test 9b)
      "2001:2::1", // benchmarking
      "2001:100::1",
      "2001:10::1", // ORCHID
      "2001::1",
      "2001:1::",
      "2001:1::4",
      "2001:4:111::1",
      "2001:1ff:ffff::1",
      // a zone id names a local interface
      "2a00:1450:4001:81b::200e%eth0",
      "fe80::1%eth0",
      "8.8.8.8%eth0",
      "not an address",
      "",
    ];
    for (const address of refused)
      expect({ address, public: isPublicAddress(address) }).toEqual({ address, public: false });
  });

  test("9. public addresses are accepted", () => {
    for (const address of [PUBLIC, "8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111", "2a00:1450:4001:81b::200e"])
      expect({ address, public: isPublicAddress(address) }).toEqual({ address, public: true });
  });
});

describe("isPublicAddress: the protocol block 2001::/23 (review NOTE 3)", () => {
  test("9b. the globally reachable entries of the IANA registry stay allowed; the rest of 2001::/23 is refused; the neighbours are public", () => {
    for (const address of [
      "2001:1::1",
      "2001:1::2",
      "2001:1::3",
      "2001:3::1", // 2001:3::/32 (AMT)
      "2001:3:ffff:ffff::1",
      "2001:4:112::1", // 2001:4:112::/48 (AS112-v6)
      "2001:20::1", // 2001:20::/28 (ORCHIDv2)
      "2001:2f:ffff::1",
      "2001:30::1", // 2001:30::/28 (Drone Remote ID)
      "2001:3f::1",
      "2001:200::1", // the first address after the block
      "2001:4860:4860::8888",
    ])
      expect({ address, public: isPublicAddress(address) }).toEqual({ address, public: true });
    for (const address of ["2001:0::1", "2001:2::1", "2001:1::5", "2001:4:113::1", "2001:40::1", "2001:1fe::1"])
      expect({ address, public: isPublicAddress(address) }).toEqual({ address, public: false });
  });
});

describe("postOneClick (the guard in front of the dialer)", () => {
  const noDial: Dial = () => {
    throw new Error("the dialer must not be called");
  };

  test("10. a refused URL never reaches the lookup or the dialer", async () => {
    let lookups = 0;
    const lookup: LookupAll = async () => {
      lookups += 1;
      return [{ address: PUBLIC, family: 4 }];
    };
    for (const text of [
      "http://news.example.com/",
      "https://news.example.com:8443/",
      "https://127.0.0.1/",
      "https://u@news.example.com/",
    ])
      expect((await postOneClick(url(text), { lookup, dial: noDial })).kind).toBe("refused");
    expect(lookups).toBe(0);
  });

  test("11. one private answer refuses the host, also behind a public one (DNS rebinding sets of answers)", async () => {
    for (const answers of [
      ["10.0.0.5"],
      ["127.0.0.1"],
      [PUBLIC, "10.0.0.5"],
      ["10.0.0.5", PUBLIC],
      ["::1"],
      ["169.254.169.254"],
      ["::ffff:10.0.0.5"],
      [PUBLIC, "fd00::1"],
    ])
      expect({
        answers,
        result: await postOneClick(url("https://news.example.com/"), { lookup: lookupOf(...answers), dial: noDial }),
      }).toEqual({
        answers,
        result: { kind: "refused", code: "private_host" },
      });
  });

  test("12. a failed or empty lookup is `dns`; a lookup that never answers ends as `timeout`", async () => {
    const dead: LookupAll = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND news.example.com"), { code: "ENOTFOUND" });
    };
    expect(await postOneClick(url("https://news.example.com/"), { lookup: dead, dial: noDial })).toEqual({
      kind: "failed",
      code: "dns",
    });
    expect(await postOneClick(url("https://news.example.com/"), { lookup: lookupOf(), dial: noDial })).toEqual({
      kind: "failed",
      code: "dns",
    });
    const hang: LookupAll = () => new Promise(() => undefined);
    expect(await postOneClick(url("https://news.example.com/"), { lookup: hang, dial: noDial, timeoutMs: 50 })).toEqual(
      {
        kind: "failed",
        code: "timeout",
      }
    );
  });

  test("13. the lookup runs once and the dialer gets the checked address, the host name, the path and the exact body", async () => {
    const dialed: DialRequest[] = [];
    let lookups = 0;
    const lookup: LookupAll = async (host) => {
      lookups += 1;
      expect(host).toBe("news.example.com");
      return [
        { address: PUBLIC, family: 4 },
        { address: "8.8.8.8", family: 4 },
      ];
    };
    const result = await postOneClick(url("https://news.example.com/u?x=1"), {
      lookup,
      dial: async (request) => {
        dialed.push(request);
        return { status: 204 };
      },
    });
    expect(result).toEqual({ kind: "ok", code: "http_204" });
    expect(lookups).toBe(1);
    expect(dialed).toHaveLength(1);
    expect(dialed[0]).toMatchObject({
      address: PUBLIC,
      hostname: "news.example.com",
      path: "/u?x=1",
      body: ONE_CLICK_BODY,
    });
    expect(ONE_CLICK_BODY).toBe("List-Unsubscribe=One-Click");
  });

  test("14. status codes map: 2xx ok, 3xx redirect (never followed), 4xx and 5xx failed", async () => {
    const answer =
      (status: number): Dial =>
      async () => ({ status });
    const run = (status: number) =>
      postOneClick(url("https://news.example.com/"), { lookup: lookupOf(PUBLIC), dial: answer(status) });
    expect(await run(200)).toEqual({ kind: "ok", code: "http_200" });
    expect(await run(202)).toEqual({ kind: "ok", code: "http_202" });
    for (const status of [301, 302, 303, 307, 308])
      expect(await run(status)).toEqual({ kind: "failed", code: "redirect" });
    expect(await run(404)).toEqual({ kind: "failed", code: "http_404" });
    expect(await run(500)).toEqual({ kind: "failed", code: "http_500" });
  });

  test("15. a dialer error becomes a code and never leaks its text", async () => {
    const run = (error: unknown) =>
      postOneClick(url("https://news.example.com/secret-path?token=abc"), {
        lookup: lookupOf(PUBLIC),
        dial: async () => {
          throw error;
        },
      });
    const codes = [
      await run(
        Object.assign(new Error("connect ECONNREFUSED 93.184.216.34:443 /secret-path"), { code: "ECONNREFUSED" })
      ),
      await run(Object.assign(new Error("cert"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })),
      await run(Object.assign(new Error("x"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })),
      await run(new Error("something else with /secret-path")),
    ];
    expect(codes).toEqual([
      { kind: "failed", code: "connect" },
      { kind: "failed", code: "tls" },
      { kind: "failed", code: "tls" },
      { kind: "failed", code: "network" },
    ]);
    expect(JSON.stringify(codes)).not.toMatch(/secret|abc|93\.184/);
  });
});

describe("the connection (sendPinned through the loopback seam)", () => {
  test("16. the server sees the exact body, the fixed headers, the host name as Host and SNI, and no cookie or credential", async () => {
    const local = await startServer((_req, res) => res.writeHead(200).end("done"));
    try {
      const dialed: DialRequest[] = [];
      const result = await postOneClick(url(`https://${HOST}/unsub/42?u=7#frag`), {
        lookup: lookupOf(PUBLIC),
        dial: viaLoopback(local, dialed),
      });
      expect(result).toEqual({ kind: "ok", code: "http_200" });
      expect(dialed[0]?.address).toBe(PUBLIC);
      expect(local.seen).toHaveLength(1);
      const seen = local.seen[0];
      if (seen === undefined) throw new Error("no request seen");
      expect(seen.method).toBe("POST");
      expect(seen.url).toBe("/unsub/42?u=7");
      expect(seen.body).toBe("List-Unsubscribe=One-Click");
      expect(seen.servername).toBe(HOST);
      expect(seen.headers.host).toBe(HOST);
      expect(seen.headers["content-type"]).toBe("application/x-www-form-urlencoded");
      expect(seen.headers["user-agent"]).toBe(ONE_CLICK_USER_AGENT);
      expect([...seen.rawHeaderNames].sort()).toEqual([
        "accept",
        "connection",
        "content-length",
        "content-type",
        "host",
        "user-agent",
      ]);
    } finally {
      local.close();
    }
  });

  test("17. a 302 is `redirect` and the Location target gets no request", async () => {
    const target = await startServer((_req, res) => res.writeHead(200).end("target"));
    const local = await startServer((_req, res) =>
      res.writeHead(302, { Location: `https://127.0.0.1:${target.port}/next` }).end()
    );
    try {
      const result = await postOneClick(url(`https://${HOST}/u`), {
        lookup: lookupOf(PUBLIC),
        dial: viaLoopback(local),
      });
      expect(result).toEqual({ kind: "failed", code: "redirect" });
      expect(local.seen).toHaveLength(1);
      expect(target.seen).toHaveLength(0);
    } finally {
      local.close();
      target.close();
    }
  });

  test("18. a server that does not answer ends as `timeout` after the total time", async () => {
    const local = await startServer(() => undefined);
    try {
      const started = Date.now();
      const result = await postOneClick(url(`https://${HOST}/u`), {
        lookup: lookupOf(PUBLIC),
        dial: viaLoopback(local),
        timeoutMs: 300,
      });
      expect(result).toEqual({ kind: "failed", code: "timeout" });
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      local.close();
    }
  });

  test("19. an endless answer is read up to the cap and dropped: the result is the status, not a hang", async () => {
    let written = 0;
    const local = await startServer((_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => {
        written += 1024;
        if (!res.write("x".repeat(1024))) return;
      }, 1);
      res.on("close", () => clearInterval(timer));
    });
    try {
      const result = await postOneClick(url(`https://${HOST}/u`), {
        lookup: lookupOf(PUBLIC),
        dial: viaLoopback(local),
        timeoutMs: 3000,
      });
      expect(result).toEqual({ kind: "ok", code: "http_200" });
      expect(written).toBeGreaterThanOrEqual(MAX_RESPONSE_BYTES);
      expect(written).toBeLessThan(1_000_000);
    } finally {
      local.close();
    }
  });

  test("20. a certificate for another name is `tls`: TLS checks the host name, not the address", async () => {
    const local = await startServer((_req, res) => res.writeHead(200).end());
    try {
      const result = await postOneClick(url("https://other.example.test/u"), {
        lookup: lookupOf(PUBLIC),
        dial: viaLoopback(local),
      });
      expect(result).toEqual({ kind: "failed", code: "tls" });
      expect(local.seen).toHaveLength(0);
    } finally {
      local.close();
    }
  });

  test("21. 404 and 500 are `failed` with the status; a closed port is `connect`", async () => {
    const local = await startServer((req, res) => res.writeHead(req.url === "/gone" ? 404 : 500).end("nope"));
    try {
      expect(
        await postOneClick(url(`https://${HOST}/gone`), { lookup: lookupOf(PUBLIC), dial: viaLoopback(local) })
      ).toEqual({ kind: "failed", code: "http_404" });
      expect(
        await postOneClick(url(`https://${HOST}/x`), { lookup: lookupOf(PUBLIC), dial: viaLoopback(local) })
      ).toEqual({ kind: "failed", code: "http_500" });
    } finally {
      local.close();
    }
    const closed = await postOneClick(url(`https://${HOST}/x`), { lookup: lookupOf(PUBLIC), dial: viaLoopback(local) });
    expect(closed).toEqual({ kind: "failed", code: "connect" });
  });
});

describe("the connection: proxy variables, total budget, header size (review TG1, TG2, TG4)", () => {
  const PROXY_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

  // An address of this host that is not loopback (many proxy clients skip loopback). Without one the test falls back to 127.0.0.1.
  const outside = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)?.address;

  test("TG1. HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy, ALL_PROXY and all_proxy set to a local listener get no connection", async () => {
    let proxyHits = 0;
    const proxy = createTcpServer((socket) => {
      proxyHits += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    const local = await startServer(
      (_req, res) => res.writeHead(200).end(),
      outside === undefined ? "127.0.0.1" : "0.0.0.0"
    );
    const saved = PROXY_NAMES.map((name) => [name, process.env[name]] as const);
    try {
      for (const name of PROXY_NAMES) process.env[name] = proxyUrl;
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;
      const result = await sendPinned(
        { address: outside ?? "127.0.0.1", hostname: HOST, path: "/u", body: ONE_CLICK_BODY, timeoutMs: 3000 },
        { port: local.port, ca: cert }
      );
      expect(result).toEqual({ status: 200 });
      expect(local.seen).toHaveLength(1);
      expect(proxyHits).toBe(0);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
      local.close();
      proxy.close();
    }
  });

  test("TG2. the total budget covers the lookup and the connection together", async () => {
    const local = await startServer((_req, res) => setTimeout(() => res.writeHead(200).end(), 250));
    try {
      const slowLookup: LookupAll = async () => {
        await Bun.sleep(400);
        return [{ address: PUBLIC, family: 4 }];
      };
      const started = Date.now();
      // 400 ms lookup + 250 ms server delay = 650 ms: over the 500 ms budget, though each step alone is inside it.
      const result = await postOneClick(url(`https://${HOST}/u`), {
        lookup: slowLookup,
        dial: viaLoopback(local),
        timeoutMs: 500,
      });
      expect(result).toEqual({ kind: "failed", code: "timeout" });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      local.close();
    }
  });

  test("TG4. a header block between 8 and 16 KiB is refused (`network`): the cap `maxHeaderSize` is ours, not the runtime default", async () => {
    const local = await startServer((_req, res) => res.writeHead(200, { "X-Pad": "a".repeat(12_000) }).end());
    try {
      const result = await postOneClick(url(`https://${HOST}/u`), {
        lookup: lookupOf(PUBLIC),
        dial: viaLoopback(local),
        timeoutMs: 3000,
      });
      expect(result).toEqual({ kind: "failed", code: "network" });
      // A small header block still works on the same server code.
      const small = await startServer((_req, res) => res.writeHead(200, { "X-Pad": "a".repeat(2000) }).end());
      try {
        expect(
          await postOneClick(url(`https://${HOST}/u`), { lookup: lookupOf(PUBLIC), dial: viaLoopback(small) })
        ).toEqual({
          kind: "ok",
          code: "http_200",
        });
      } finally {
        small.close();
      }
    } finally {
      local.close();
    }
  });
});

describe("the production path has no way to reach a local host", () => {
  const root = join(import.meta.dir, "..");
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
      return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
    });

  test("22. no production file passes a `dial` or a `sendPinned`, and `postOneClick` is called only with a lookup", () => {
    const callers: string[] = [];
    for (const path of sources(root)) {
      const text = readFileSync(path, "utf8");
      // The client itself, and the registry that names the call in a string (`outside-services.ts`).
      if (path.endsWith("platform/public-http.ts") || path.endsWith("platform/outside-services.ts")) continue;
      expect({ path, dial: /\bdial\s*:/.test(text) || /\bsendPinned\b/.test(text) }).toEqual({ path, dial: false });
      if (/\bpostOneClick\(/.test(text)) callers.push(path.slice(root.length + 1));
      for (const call of text.matchAll(/postOneClick\(([^)]*)\)/g))
        expect({ path, call: call[1] }).toEqual({
          path,
          call: expect.stringMatching(/\{\s*lookup: dnsLookupAll[^}]*\}/),
        });
    }
    expect(callers.sort()).toEqual(["web-routers.ts"]);
  });
});
