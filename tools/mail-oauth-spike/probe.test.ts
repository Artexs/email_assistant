import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { ENDPOINTS, startCallbackServer, type CallbackParams } from "./oauth";
import { parseArgs, readEnv, runProbe } from "./probe";
import type { Deps, Row, SpikeEnv } from "./rows";
import { MICROSOFT_ROWS } from "./rows-microsoft";

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
