import { Api } from "grammy";

/** Asks the Bot API who owns the token (`getMe`). The result holds no secret. */
export async function checkBot(token: string, opts?: { apiRoot?: string }): Promise<{ id: number; username: string }> {
  const api = new Api(token, opts?.apiRoot === undefined ? undefined : { apiRoot: opts.apiRoot });
  const me = await api.getMe();
  return { id: me.id, username: me.username };
}
