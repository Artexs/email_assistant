import { createCliOutput } from "../../../apps/server/src/platform/cli";

import { replayAnswer, type ReplayTable } from "./replay";

export interface ReplayServer {
  port: number;
  stats(): { hits: number; misses: number };
  stop(): Promise<void>;
}

export interface ReplayServerOptions {
  /** 0 (default): the OS picks a free port. */
  port?: number;
  /** One call per request. Default: the CLI output. */
  log?: (line: string) => void;
}

// The path that the OpenAI adapter calls (`client.responses.create`): `<base URL>/responses`.
const RESPONSES_PATH = /\/responses$/;
const STATS_PATH = "/_replay/stats";

// The Responses API form that the SDK reads: `output_text` is built from the message item.
function responseBody(answerText: string, model: unknown) {
  return {
    id: "resp_replay",
    object: "response",
    created_at: 0,
    status: "completed",
    model: typeof model === "string" ? model : "replay",
    output: [
      {
        id: "msg_replay",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: answerText, annotations: [] }],
      },
    ],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}

/** Answers the classifier calls of the recording on 127.0.0.1. A request that is not a replayed call is a 404. */
export async function startReplayServer(table: ReplayTable, options: ReplayServerOptions = {}): Promise<ReplayServer> {
  const out = createCliOutput("llm-replay");
  const log = options.log ?? ((line: string) => out.print(line));
  let hits = 0;
  let misses = 0;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === STATS_PATH) return Response.json({ hits, misses });
      if (request.method !== "POST" || !RESPONSES_PATH.test(pathname))
        return new Response("not found", { status: 404 });
      const body: unknown = await request.json().catch(() => undefined);
      const result = replayAnswer(table, body);
      if (result.status === 200) {
        hits += 1;
        log(`replay ${pathname} 200 ${result.body.reason_code}`);
        const model = typeof body === "object" && body !== null ? (body as { model?: unknown }).model : undefined;
        return Response.json(responseBody(JSON.stringify(result.body), model));
      }
      misses += 1;
      log(`replay ${pathname} 500 ${result.reason}`);
      return Response.json(
        { error: { type: "replay_miss", code: result.reason, message: result.reason } },
        { status: 500 }
      );
    },
  });

  const port = server.port;
  if (port === undefined) throw new Error("replay server has no port");
  return {
    port,
    stats: () => ({ hits, misses }),
    stop: async () => {
      await server.stop(true);
    },
  };
}
