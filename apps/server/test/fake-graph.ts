// A fake Microsoft Graph `sendMail` server for the mailbox OAuth tests (F117 stage 13): `Bun.serve` on `http://127.0.0.1:<random port>`.
// A TEST DOUBLE ONLY. It sends nothing anywhere: it keeps the mail it got in memory. No production code reads its URL (the provider
// registry holds the real one; a test passes `baseUrl` in).
// It is as strict as the sender must be: POST, the bearer header, `Content-Type: text/plain` and a base64 body. Else it answers 400.

export interface FakeGraphCall {
  authorization: string;
  raw: Buffer;
}

export interface FakeGraph {
  /** `http://127.0.0.1:<port>`. */
  baseUrl: string;
  /** The mails the server accepted (answered 202), in order. */
  sent: FakeGraphCall[];
  /** Every well-formed call, also the refused ones, in order. */
  calls: FakeGraphCall[];
  /** The next well-formed call gets this answer (queued: each call takes one). `body` is the JSON of the answer. */
  respondNext(status: number, body?: unknown): void;
  /** The next well-formed call gets no answer until `stop()`. */
  hangNext(): void;
  stop(): Promise<void>;
}

type Answer = { status: number; body: unknown } | "hang";

export async function startFakeGraph(): Promise<FakeGraph> {
  const sent: FakeGraphCall[] = [];
  const calls: FakeGraphCall[] = [];
  const answers: Answer[] = [];
  let release: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization") ?? "";
      const body = await request.text();
      const wellFormed =
        request.method === "POST" &&
        url.pathname === "/v1.0/me/sendMail" &&
        /^Bearer \S+$/.test(authorization) &&
        (request.headers.get("content-type") ?? "").toLowerCase().startsWith("text/plain") &&
        body !== "" &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(body);
      if (!wellFormed) {
        return Response.json({ error: { code: "BadRequest", message: "malformed request" } }, { status: 400 });
      }
      const call = { authorization, raw: Buffer.from(body, "base64") };
      calls.push(call);
      const answer = answers.shift() ?? { status: 202, body: undefined };
      if (answer === "hang") {
        await stopped;
        return new Response(null, { status: 503 });
      }
      if (answer.status === 202) sent.push(call);
      return answer.body === undefined
        ? new Response(null, { status: answer.status })
        : Response.json(answer.body, { status: answer.status });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    sent,
    calls,
    respondNext(status, body) {
      answers.push({ status, body });
    },
    hangNext() {
      answers.push("hang");
    },
    async stop() {
      release();
      await server.stop(true);
    },
  };
}
