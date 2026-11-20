/** Where a secret comes from: stdin. `isTTY` is true when a person types into a terminal. */
export interface SecretSource {
  isTTY?: boolean;
  read(): Promise<string>;
}

export type StdinSecret = { ok: true; secret: string } | { ok: false; refusal: string };

const processStdin = (): SecretSource => ({ isTTY: process.stdin.isTTY, read: () => Bun.stdin.text() });

/**
 * Reads a secret from a pipe (docs/cli.md § Arguments: a secret never comes from an argument). A terminal would show the typed
 * secret, so a TTY is a refusal; so is an empty secret. The refusal text names the reason and never a value.
 */
export async function readStdinSecret(source: SecretSource = processStdin()): Promise<StdinSecret> {
  if (source.isTTY) {
    return {
      ok: false,
      refusal: "refused: stdin is a terminal; pipe the password in (it never comes from an argument)",
    };
  }
  const secret = (await source.read()).replace(/\r?\n$/, "");
  return secret === "" ? { ok: false, refusal: "refused: the password on stdin is empty" } : { ok: true, secret };
}
