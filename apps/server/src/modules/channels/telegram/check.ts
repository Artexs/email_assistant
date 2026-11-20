import { Api, HttpError } from "grammy";

import { SoftError } from "../../../platform/errors";

/**
 * Asks the Bot API who owns the token (`getMe`). The result holds no secret. A request that got no answer (refused
 * connection, DNS, timeout) is a `SoftError`: the CLI exits 3 for it. It has no `cause`: the inner error of grammY's
 * `HttpError` holds the URL with the token. A `GrammyError` (the API answered with an error) stays as it is.
 */
export async function checkBot(token: string, opts?: { apiRoot?: string }): Promise<{ id: number; username: string }> {
  const api = new Api(token, opts?.apiRoot === undefined ? undefined : { apiRoot: opts.apiRoot });
  try {
    const me = await api.getMe();
    return { id: me.id, username: me.username };
  } catch (error) {
    if (error instanceof HttpError) {
      throw new SoftError("Telegram did not answer (getMe)");
    }
    throw error;
  }
}
