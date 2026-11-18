import { createCliOutput } from "../platform/cli";
import { generateVapidKeyPair } from "../platform/vapid-keys";

// `bun run push:keys`: prints a new VAPID key pair (RFC 8292) as the three `.env` lines of Web Push (F118). The owner runs it,
// never an agent: the private key goes to the terminal of the owner. It reads no config, opens no database, makes no request and
// writes no file or log line. The subject line is a placeholder that the owner edits.
const out = createCliOutput("push-keys");

if (process.argv.length > 2) {
  out.fail("usage: bun run push:keys");
  process.exit(1);
}
const keys = generateVapidKeyPair();
out.print(
  "Put these lines into the .env of the server. Keep the private key secret. A new pair ends every subscribed device."
);
out.print(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
out.print(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
out.print("VAPID_SUBJECT=mailto:<your address>");
