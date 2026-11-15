import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import type { ImapSession } from "./mail";
import { ENDPOINTS, startCallbackServer, type CallbackParams } from "./oauth";
import { parseArgs, readEnv, runProbe } from "./probe";
import type { Ctx, Deps, Row, SpikeEnv } from "./rows";
import { GOOGLE_ROWS } from "./rows-google";
import { MICROSOFT_ROWS, PERSONAL_ROWS } from "./rows-microsoft";

// No test here calls a real Microsoft or Google endpoint. The token endpoint is a fake `fetch`; IMAP and SMTP point to a
// closed port on this machine.

const dirs: string[] = [];
const tempFile = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "spike-test-"));
  dirs.push(dir);
  return join(dir, "result.json");
};
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const OWNER = "boss@x.test";
const env: SpikeEnv = { clientId: "client-id-1", clientSecret: "CLIENT-SECRET-CANARY", ownerAddress: OWNER };

function fakeDeps(overrides: Partial<Deps> = {}): { deps: Deps; said: string[] } {
  const said: string[] = [];
  const deps: Deps = {
    fetch: (() => Promise.reject(new Error("no network in this test"))) as unknown as typeof fetch,
    ask: () => Promise.resolve("y"),
    askSecret: () => Promise.resolve(null),
    say: (line) => void said.push(line),
    browse: () => Promise.reject(new Error("no browser in this test")),
    sleep: () => Promise.resolve(),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return { deps, said };
}

const row = (id: string, evidence: unknown): Row => ({
  id,
  run: () => Promise.resolve({ verdict: "PASS", evidence: evidence as string }),
});

describe("runProbe result file", () => {
  test("one bad row gives no file and exit 1, and nothing of it is shown", async () => {
    const out = await tempFile();
    const { deps, said } = fakeDeps();
    const code = await runProbe({
      provider: "google",
      out,
      env,
      deps,
      rows: [row("G1", "capabilities MOVE UIDPLUS"), row("G2", "refresh M.C507_BAY.0.U.-CqLEAKED"), row("G3", "202")],
    });
    expect(code).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(said.join("\n")).not.toContain("LEAKED");
    expect(said.join("\n")).toContain("G2");
    expect(said.join("\n")).toContain("microsoft-refresh-token");
  });

  test("an evidence that is not a string counts as a bad row", async () => {
    const out = await tempFile();
    const { deps } = fakeDeps();
    expect(await runProbe({ provider: "google", out, env, deps, rows: [row("G1", { token: "x" })] })).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  test("good rows give the file with the documented shape; the owner address is masked", async () => {
    const out = await tempFile();
    const { deps } = fakeDeps();
    const code = await runProbe({
      provider: "google",
      out,
      env,
      deps,
      rows: [row("G1", "login ok"), row("G2", `mail to ${OWNER} and boss+ea-spike@x.test`)],
    });
    expect(code).toBe(0);
    const result = JSON.parse(await readFile(out, "utf8")) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["provider", "ranAt", "rows"]);
    expect(result["provider"]).toBe("google");
    expect(result["ranAt"]).toBe("2023-11-14T22:13:20.000Z");
    expect(result["rows"]).toEqual([
      { id: "G1", verdict: "PASS", evidence: "login ok" },
      { id: "G2", verdict: "PASS", evidence: "mail to <owner> and <owner>" },
    ]);
  });

  test("a row that throws is a FAIL row with codes only, and its message never reaches the file", async () => {
    const out = await tempFile();
    const { deps, said } = fakeDeps();
    const throwing: Row = {
      id: "M1",
      run: () => Promise.reject(new Error("Bearer eyJSECRETSECRETSECRET for boss@x.test")),
    };
    expect(await runProbe({ provider: "microsoft", out, env, deps, rows: [throwing] })).toBe(0);
    const written = await readFile(out, "utf8");
    expect(written).toContain('"verdict": "FAIL"');
    expect(written).not.toContain("SECRET");
    expect(said.join("\n")).not.toContain("SECRET");
  });
});

describe("callback server", () => {
  test("refuses a wrong or missing state with 400, then stops after one good request", async () => {
    const server = startCallbackServer({ port: 0, state: "good-state-value", timeoutMs: 10_000 });
    try {
      expect((await fetch(`${server.origin}/callback?state=wrong&code=c1`)).status).toBe(400);
      expect((await fetch(`${server.origin}/callback?code=c1`)).status).toBe(400);
      expect((await fetch(`${server.origin}/other?state=good-state-value`)).status).toBe(404);
      let settled = false;
      void server.result.then(() => (settled = true));
      await Bun.sleep(20);
      expect(settled).toBe(false);

      const good = await fetch(`${server.origin}/callback?state=good-state-value&code=c2&admin_consent=True`);
      expect(good.status).toBe(200);
      const params: CallbackParams = await server.result;
      expect(params).toEqual({ state: "good-state-value", code: "c2", admin_consent: "True" });

      // The server is closed after the one good request.
      let refused = false;
      for (let attempt = 0; attempt < 20 && !refused; attempt += 1) {
        refused = await fetch(`${server.origin}/callback?state=good-state-value`).then(
          () => false,
          () => true
        );
        if (!refused) await Bun.sleep(25);
      }
      expect(refused).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("the wait ends with an error at the timeout", async () => {
    const server = startCallbackServer({ port: 0, state: "s", timeoutMs: 50 });
    await expect(server.result).rejects.toThrow("callback timeout");
  });
});

describe("Microsoft token rows with a fake token server", () => {
  // Each canary matches one of these patterns; the fake token server issues numbered refresh tokens.
  const CANARY_PATTERNS = [/eyJ-ACCESS/, /M\.C-REFRESH/, /CODE-CANARY/, /CLIENT-SECRET-CANARY/, /STATE-CANARY/, /boss/];

  const jwt = (claims: Record<string, string>): string =>
    ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

  function fakeTokenServer() {
    const forms: URLSearchParams[] = [];
    let issued = 0;
    let removed = false;
    const fetchFn = ((_url: string | URL | Request, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body ?? ""));
      forms.push(form);
      const json = (status: number, body: Record<string, unknown>): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const grant = form.get("grant_type");
      if (grant === "authorization_code") {
        return Promise.resolve(
          json(200, {
            access_token: "eyJ-ACCESS-IMAP-CANARY",
            refresh_token: "M.C-REFRESH-0-CANARY",
            id_token: jwt({ email: OWNER, preferred_username: OWNER }),
            scope: "https://outlook.office.com/IMAP.AccessAsUser.All email openid profile",
          })
        );
      }
      if (form.get("refresh_token") === "garbage-refresh-token") removed = true;
      if (removed) {
        return Promise.resolve(
          json(400, {
            error: "invalid_grant",
            error_codes: [70000],
            error_description: "AADSTS70000: bad M.C-REFRESH-0-CANARY for boss@x.test STATE-CANARY",
          })
        );
      }
      issued += 1;
      return Promise.resolve(
        json(200, {
          access_token: "eyJ-ACCESS-GRAPH-CANARY",
          refresh_token: `M.C-REFRESH-${issued}-CANARY`,
          scope: "https://graph.microsoft.com/Mail.Send",
        })
      );
    }) as typeof fetch;
    return { fetchFn, forms };
  }

  test("no token, code, state, client secret or address reaches the file or the screen; PKCE S256 binds the verifier", async () => {
    const out = await tempFile();
    const server = fakeTokenServer();
    let authorizeUrl = "";
    const { deps, said } = fakeDeps({
      fetch: server.fetchFn,
      browse: (buildUrl) => {
        authorizeUrl = buildUrl("STATE-CANARY");
        return Promise.resolve({ code: "CODE-CANARY", state: "STATE-CANARY" });
      },
    });
    // IMAP and SMTP go to a closed local port: the login rows fail with codes only.
    const closed = { host: "127.0.0.1", port: 1, secure: false };
    const endpoints = { ...ENDPOINTS.microsoft, imap: closed, smtp: closed };
    const wanted = ["M1", "M2", "M3", "M9", "M11", "M12", "M13"];
    const rows = MICROSOFT_ROWS.filter((candidate) => wanted.includes(candidate.id));
    const code = await runProbe({ provider: "microsoft", out, env, deps, endpoints, rows });
    expect(code).toBe(0);

    const written = await readFile(out, "utf8");
    const shown = said.join("\n");
    // The canaries really flowed through the fake token server, so the checks below are not empty.
    const sent = `${server.forms.map((form) => form.toString()).join("&")}&${authorizeUrl}`;
    for (const pattern of [/M\.C-REFRESH-0/, /M\.C-REFRESH-1/, /CODE-CANARY/, /CLIENT-SECRET-CANARY/, /STATE-CANARY/]) {
      expect(sent).toMatch(pattern);
    }
    for (const pattern of CANARY_PATTERNS) {
      expect(written).not.toMatch(pattern);
      expect(shown.replace(authorizeUrl, "")).not.toMatch(pattern);
    }

    const result = JSON.parse(written) as { rows: { id: string; verdict: string; evidence: string }[] };
    const byId = Object.fromEntries(result.rows.map((item) => [item.id, item]));
    expect(byId["M2"]?.verdict).toBe("PASS");
    expect(byId["M2"]?.evidence).toContain("https://graph.microsoft.com/Mail.Send");
    expect(byId["M11"]?.verdict).toBe("PASS");
    expect(byId["M13"]?.evidence).toContain("AADSTS70000");
    expect(byId["M3"]?.verdict).toBe("FAIL");

    // PKCE S256: the challenge in the authorize URL is the hash of the verifier sent to the token endpoint.
    const url = new URL(authorizeUrl);
    const verifier = server.forms.find((form) => form.get("grant_type") === "authorization_code")?.get("code_verifier");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(verifier).toBeDefined();
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(verifier ?? "")
        .digest("base64url")
    );
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8765/callback");
    // The token request names the same redirect URI as the authorize call, character for character.
    const redeemForm = server.forms.find((form) => form.get("grant_type") === "authorization_code");
    expect(redeemForm?.get("redirect_uri")).toBe("http://localhost:8765/callback");
    expect(url.searchParams.get("scope")).toContain("https://outlook.office.com/IMAP.AccessAsUser.All");
    expect(url.searchParams.get("scope")).toContain("https://graph.microsoft.com/Mail.Send");
  });
});

describe("CLI input", () => {
  test("parseArgs takes a provider and --out only", () => {
    expect(parseArgs(["google", "--out", "r.json"])).toEqual({ provider: "google", out: "r.json" });
    expect(parseArgs(["yahoo", "--out", "r.json"])).toHaveProperty("error");
    expect(parseArgs(["google"])).toHaveProperty("error");
    expect(parseArgs(["google", "--out", "r.json", "extra"])).toHaveProperty("error");
  });

  test("readEnv names the missing variables and never echoes a value", () => {
    const missing = readEnv("google", { SPIKE_GOOGLE_CLIENT_ID: "id-1" });
    expect(missing).toEqual({
      error: "Set these environment variables first: SPIKE_GOOGLE_CLIENT_SECRET, SPIKE_OWNER_ADDRESS.",
    });
    const bad = readEnv("microsoft", { SPIKE_MS_CLIENT_ID: "id-1", SPIKE_OWNER_ADDRESS: "not an address TOP-SECRET" });
    expect(JSON.stringify(bad)).not.toContain("TOP-SECRET");
    expect(readEnv("microsoft", { SPIKE_MS_CLIENT_ID: "id-1", SPIKE_OWNER_ADDRESS: OWNER })).toEqual({
      clientId: "id-1",
      ownerAddress: OWNER,
    });
  });
});

describe("known secret values", () => {
  const seedRow = (id: string, seed: (ctx: Ctx) => string): Row => ({
    id,
    run: (ctx) => Promise.resolve({ verdict: "PASS", evidence: seed(ctx) }),
  });

  test("evidence that holds the exact value of a known secret is refused: no file, exit 1", async () => {
    const cases: [string, (ctx: Ctx) => string][] = [
      ["client secret", () => `value ${env.clientSecret}`],
      ["client id", () => `value ${env.clientId}`],
      [
        "verifier",
        (ctx) => {
          ctx.state.verifier = "plainVerifierValue1";
          return "value plainVerifierValue1";
        },
      ],
      [
        "code and state",
        (ctx) => {
          ctx.state.params = { code: "plainAuthCode77", state: "plainStateValue88" };
          return "value plainStateValue88";
        },
      ],
      [
        "token",
        (ctx) => {
          ctx.state.tokens = { imap: "plainAccess99", imapScope: "x", refresh: "plainRefresh55" };
          return "value plainRefresh55";
        },
      ],
    ];
    for (const [name, evidence] of cases) {
      const out = await tempFile();
      const { deps, said } = fakeDeps();
      const code = await runProbe({ provider: "google", out, env, deps, rows: [seedRow("G1", evidence)] });
      expect(`${name}: ${code}`).toBe(`${name}: 1`);
      expect(existsSync(out)).toBe(false);
      expect(said.join("\n")).toContain("known-secret");
    }
  });

  test("a short value is not a secret, and a clean row passes", async () => {
    const out = await tempFile();
    const { deps } = fakeDeps();
    const code = await runProbe({ provider: "google", out, env, deps, rows: [seedRow("G1", () => "login ok")] });
    expect(code).toBe(0);
  });
});

describe("callback server bind", () => {
  const LOOPBACK = new Set(["0100007F", "00000000000000000000000001000000"]);

  function listeners(port: number): string[] {
    const found: string[] = [];
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
        const columns = line.trim().split(/\s+/);
        const [address, hexPort] = (columns[1] ?? "").split(":");
        if (columns[3] === "0A" && address !== undefined && Number.parseInt(hexPort ?? "", 16) === port)
          found.push(address);
      }
    }
    return found;
  }

  test("every listener of the port is loopback, on both families, and they all answer", async () => {
    const server = startCallbackServer({ port: 0, state: "s", timeoutMs: 10_000 });
    try {
      const port = Number(new URL(server.origin).port);
      if (existsSync("/proc/net/tcp")) {
        const found = listeners(port);
        expect(found.length).toBeGreaterThanOrEqual(1);
        for (const address of found) expect(LOOPBACK.has(address)).toBe(true);
        expect(found).toContain("0100007F");
      }
      expect((await fetch(`http://127.0.0.1:${port}/callback?state=x`)).status).toBe(400);
      if (existsSync("/proc/net/tcp6") && listeners(port).includes("00000000000000000000000001000000")) {
        expect((await fetch(`http://[::1]:${port}/callback?state=x`)).status).toBe(400);
      }
    } finally {
      server.stop();
    }
  });

  test("a port that another process holds on 127.0.0.1 or on ::1 stops the start", () => {
    const v4 = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("other") });
    try {
      expect(() => startCallbackServer({ port: v4.port ?? 0, state: "s", timeoutMs: 1000 })).toThrow();
    } finally {
      void v4.stop();
    }
    let v6: ReturnType<typeof Bun.serve> | undefined;
    try {
      v6 = Bun.serve({ port: 0, hostname: "::1", fetch: () => new Response("other") });
    } catch {
      return; // no IPv6 on this machine
    }
    try {
      expect(() => startCallbackServer({ port: v6?.port ?? 0, state: "s", timeoutMs: 1000 })).toThrow();
      // The failed start leaves no listener on 127.0.0.1 behind.
      if (existsSync("/proc/net/tcp")) expect(listeners(v6.port ?? 0)).not.toContain("0100007F");
    } finally {
      void v6.stop();
    }
  });
});

describe("big LIST", () => {
  function fakeImap(options: {
    folders: { path: string; specialUse?: string }[];
    capabilities: string[];
  }): ImapSession {
    return {
      logout: () => Promise.resolve(),
      capabilities: new Map(options.capabilities.map((name) => [name, true])),
      list: () => Promise.resolve(options.folders.map((folder) => ({ ...folder, name: folder.path, delimiter: "/" }))),
    } as unknown as ImapSession;
  }
  const seeded = (row: Row | undefined, imap: ImapSession): Row => ({
    id: row?.id ?? "?",
    run: (ctx) => {
      ctx.state.imap = imap;
      ctx.state.login = "boss@x.test";
      return (row as Row).run(ctx);
    },
  });

  test("70 folders and a 48-character folder name still give a result file with the special-use folders by name", async () => {
    const folders = [
      { path: "INBOX" },
      { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
      { path: "[Gmail]/Drafts", specialUse: "\\Drafts" },
      { path: `L${"x".repeat(47)}`, specialUse: "\\Archive" },
      ...Array.from({ length: 66 }, (_, index) => ({ path: `Label number ${index}` })),
    ];
    const imap = fakeImap({
      folders,
      capabilities: ["IMAP4REV1", "AUTH=XOAUTH2", "MOVE", "UIDPLUS", "SPECIAL-USE", "IDLE"],
    });
    for (const [provider, row] of [
      ["microsoft", MICROSOFT_ROWS.find((item) => item.id === "M4")],
      ["google", GOOGLE_ROWS.find((item) => item.id === "G2")],
    ] as const) {
      const out = await tempFile();
      const { deps } = fakeDeps();
      expect(await runProbe({ provider, out, env, deps, rows: [seeded(row, imap)] })).toBe(0);
      const written = JSON.parse(await readFile(out, "utf8")) as { rows: { evidence: string }[] };
      const evidence = written.rows[0]?.evidence ?? "";
      expect(evidence).toContain("[Gmail]/Sent Mail \\Sent");
      expect(evidence).toContain("other folders: 66");
      expect(evidence).toContain(`L${"x".repeat(29)}... \\Archive`);
      expect(evidence.length).toBeLessThan(1000);
    }
  });
});

describe("send targets", () => {
  const SENT_HEADER = /^(to|cc|bcc|reply-to|sender|resent-.*|delivered-to):/i;

  function mimeHeaders(mime: string): string {
    return mime.split(/\r?\n\r?\n/)[0] ?? "";
  }

  function recipientsIn(headers: string): Record<string, string> {
    const found: Record<string, string> = {};
    for (const line of headers.split(/\r?\n(?=\S)/)) {
      if (SENT_HEADER.test(line))
        found[line.slice(0, line.indexOf(":")).toLowerCase()] = line.slice(line.indexOf(":") + 1).trim();
    }
    return found;
  }

  function fakeMailbox(getHeaders: () => string, folder: { path: string; specialUse: string }): ImapSession {
    return {
      logout: () => Promise.resolve(),
      capabilities: new Map(),
      list: () =>
        Promise.resolve([
          { path: "INBOX", name: "INBOX", delimiter: "/" },
          { ...folder, name: folder.path, delimiter: "/" },
        ]),
      getMailboxLock: () => Promise.resolve({ release: () => undefined }),
      search: () => Promise.resolve([1]),
      fetchOne: () => Promise.resolve({ headers: Buffer.from(getHeaders()) }),
    } as unknown as ImapSession;
  }

  const seed = (row: Row | undefined, imap: ImapSession, ctxSeed: (ctx: Ctx) => void): Row => ({
    id: row?.id ?? "?",
    run: (ctx) => {
      ctx.state.imap = imap;
      ctx.state.login = OWNER;
      ctx.state.redeem = Promise.resolve({ ok: true });
      ctx.state.tokens = {
        imap: "plainImapToken1",
        imapScope: "x",
        graph: "plainGraphToken1",
        graphScope: "y",
        refresh: "plainRefresh11",
      };
      ctxSeed(ctx);
      return (row as Row).run(ctx);
    },
  });

  function fakeGraph() {
    const sent: string[] = [];
    const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/me/sendMail")) sent.push(Buffer.from(String(init?.body), "base64").toString("utf8"));
      return Promise.resolve(new Response(null, { status: 202 }));
    }) as typeof fetch;
    return { sent, fetchFn };
  }

  test("M10 sends to the To plus-address and the Bcc plus-address only", async () => {
    const graph = fakeGraph();
    const { deps } = fakeDeps({ fetch: graph.fetchFn });
    const imap = fakeMailbox(() => mimeHeaders(graph.sent[0] ?? ""), { path: "Sent Items", specialUse: "\\Sent" });
    const out = await tempFile();
    const row = MICROSOFT_ROWS.find((item) => item.id === "M10");
    expect(await runProbe({ provider: "microsoft", out, env, deps, rows: [seed(row, imap, () => undefined)] })).toBe(0);
    expect(graph.sent).toHaveLength(1);
    expect(recipientsIn(mimeHeaders(graph.sent[0] ?? ""))).toEqual({
      to: "boss+ea-spike@x.test",
      bcc: "boss+ea-spike-bcc@x.test",
    });
    const result = JSON.parse(await readFile(out, "utf8")) as { rows: { verdict: string }[] };
    expect(result.rows[0]?.verdict).toBe("PASS");
  });

  test("P1 sends to the To plus-address only", async () => {
    const graph = fakeGraph();
    const { deps } = fakeDeps({ fetch: graph.fetchFn });
    const imap = fakeMailbox(() => "", { path: "Sent Items", specialUse: "\\Sent" });
    const out = await tempFile();
    const row = PERSONAL_ROWS[0];
    expect(
      await runProbe({ provider: "microsoft-personal", out, env, deps, rows: [seed(row, imap, () => undefined)] })
    ).toBe(0);
    expect(graph.sent).toHaveLength(1);
    expect(recipientsIn(mimeHeaders(graph.sent[0] ?? ""))).toEqual({ to: "boss+ea-spike@x.test" });
  });

  test("G5 sends over SMTP to the To plus-address only (RCPT TO and the headers)", async () => {
    const rcpt: string[] = [];
    const from: string[] = [];
    let data = "";
    const smtp = createServer((socket) => {
      let inData = false;
      let buffer = "";
      socket.write("220 fake ESMTP\r\n");
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        for (;;) {
          if (inData) {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end < 0) return;
            data = buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            inData = false;
            socket.write("250 queued\r\n");
            continue;
          }
          const eol = buffer.indexOf("\r\n");
          if (eol < 0) return;
          const line = buffer.slice(0, eol);
          buffer = buffer.slice(eol + 2);
          if (/^EHLO/i.test(line)) socket.write("250-fake\r\n250 AUTH XOAUTH2\r\n");
          else if (/^AUTH/i.test(line)) socket.write("235 ok\r\n");
          else if (/^MAIL FROM/i.test(line)) {
            from.push(line);
            socket.write("250 ok\r\n");
          } else if (/^RCPT TO/i.test(line)) {
            rcpt.push(line);
            socket.write("250 ok\r\n");
          } else if (/^DATA/i.test(line)) {
            socket.write("354 go\r\n");
            inData = true;
          } else if (/^QUIT/i.test(line)) {
            socket.write("221 bye\r\n");
            socket.end();
          } else socket.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
    try {
      const address = smtp.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const { deps } = fakeDeps();
      const imap = fakeMailbox(() => "", { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" });
      const out = await tempFile();
      const row = GOOGLE_ROWS.find((item) => item.id === "G5");
      const endpoints = { ...ENDPOINTS.google, smtp: { host: "127.0.0.1", port, secure: false } };
      expect(
        await runProbe({ provider: "google", out, env, deps, endpoints, rows: [seed(row, imap, () => undefined)] })
      ).toBe(0);
      expect(rcpt).toEqual(["RCPT TO:<boss+ea-spike@x.test>"]);
      expect(from).toHaveLength(1);
      expect(recipientsIn(mimeHeaders(data))).toEqual({ to: "boss+ea-spike@x.test" });
    } finally {
      smtp.close();
    }
  });
});
