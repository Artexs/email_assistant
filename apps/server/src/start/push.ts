import { createPushSender } from "../modules/channels";
import { pushConfigOf } from "../platform/config";

import type { StartContext } from "./context";

// The push sender (E9b, ADR 0032): the `push` rows of the outbox go to the browsers of the members as Web Push messages. It needs the VAPID keys
// and no Telegram bot: a push-only member has none. Without the keys the job does not exist and the rows would wait (they exist
// only with the flag `web_push` on, which the panel allows only on a server that has the keys). The request uses the global `fetch`
// (it honours `HTTPS_PROXY`, see `PushSenderDeps`); the sender checks the flag again for every row.
export function startPush(ctx: StartContext): void {
  const { config, db, log, scheduler, runs, secrets } = ctx;
  const pushKeys = pushConfigOf(config);
  if (pushKeys === null) {
    log.info("push_off");
  } else {
    const pushSender = createPushSender({ db, box: secrets, keys: pushKeys, fetch, now: () => new Date() });
    // prettier-ignore
    scheduler.add("channels.push", "*/15 * * * * *", runs.track("channels.push", () => pushSender.run()));
    log.info("job_scheduled", { job: "channels.push" });
  }
}
