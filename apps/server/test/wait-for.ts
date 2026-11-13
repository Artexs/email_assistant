/** Polls `condition` every `everyMs` until it is true; throws after `timeoutMs`. Use it instead of a fixed sleep. */
export async function waitFor(
  condition: () => boolean,
  what: string,
  opts: { timeoutMs?: number; everyMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const everyMs = opts.everyMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (condition()) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: ${what} not true after ${timeoutMs} ms`);
    }
    await Bun.sleep(everyMs);
  }
}
