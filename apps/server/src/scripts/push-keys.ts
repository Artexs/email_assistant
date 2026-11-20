import { runCli, type CliSpec } from "../platform/cli";
import { generateVapidKeyPair } from "../platform/vapid-keys";

import { cliDescriptions, parsePushKeysArgs } from "./push-keys-args";

// `bun run push:keys`: prints a new VAPID key pair (RFC 8292) as the three `.env` lines of Web Push. The owner runs it,
// never an agent: the private key goes to the terminal of the owner. It reads no config, opens no database, makes no request and
// writes no file or log line. The subject line is a placeholder that the owner edits (it fails the config check until then).
const main: CliSpec["main"] = async (argv, out) => {
  // Parse first: a bad argument exits 2 before a key exists.
  parsePushKeysArgs(argv);
  const keys = generateVapidKeyPair();
  // The explanation keeps the prefix. The three env lines are bare (`raw`): Bun's .env loader drops a line with a prefix, and Web Push
  // would stay off without an error. The owner pastes the three lines into .env as they are and edits the subject.
  out.print(
    "Paste the three lines below into the .env of the server. Never log or commit the private key. A new pair ends every subscribed device."
  );
  out.raw(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  out.raw(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  out.raw("VAPID_SUBJECT=mailto:<your address>");
  return 0;
};

if (import.meta.main) await runCli({ prefix: "push-keys", descriptions: cliDescriptions, main });
