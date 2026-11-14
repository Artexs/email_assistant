import { link, open, stat, unlink } from "node:fs/promises";

import { Encrypter } from "age-encryption";

// True for a public `age` key that the library parses. Passphrase mode is not supported (F106 Q5).
export function isAgeRecipient(value: string): boolean {
  if (!value.startsWith("age1")) return false;
  try {
    new Encrypter().addRecipient(value);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

// The chunks go through the encrypter one by one, so the whole text is never in memory (and never on disk in plain).
function toByteStream(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

// Writes `chunks`, encrypted to one `age` public key, to `path` (F106 stage 05, D14).
//
// The bytes go to `path.part` (create only, mode 600). At the end `link` makes `path` and `unlink` removes the part, so a
// file that already exists at `path` is never replaced, not even by one that appears while this runs. Any error removes
// the part and throws again; no plain text is written to disk at any point. A part that exists already is not ours: the
// open fails and the part stays.
export async function writeEncryptedFile(
  path: string,
  recipient: string,
  chunks: AsyncIterable<string>
): Promise<{ kind: "written"; bytes: number } | { kind: "exists" }> {
  if (await pathExists(path)) return { kind: "exists" };

  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  const part = `${path}.part`;
  const handle = await open(part, "wx", 0o600);
  let bytes = 0;
  let closed = false;
  try {
    const reader = (await encrypter.encrypt(toByteStream(chunks))).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await handle.write(value);
      bytes += value.byteLength;
    }
    await handle.sync();
    await handle.close();
    closed = true;
    try {
      await link(part, path);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await unlink(part);
      return { kind: "exists" };
    }
    await unlink(part);
    return { kind: "written", bytes };
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await unlink(part).catch(() => undefined);
    throw error;
  }
}
