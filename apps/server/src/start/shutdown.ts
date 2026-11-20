// The stop order of the server. `main.ts` builds the steps from its values; the order and the two waits live here.

export interface ShutdownSteps {
  stopScheduler(): void;
  stopTelegram: (() => Promise<void>) | null; // read at shutdown time (late binding)
  settled(): Promise<void>;
  stopServer(): Promise<void>;
  closeWeb(): Promise<void>;
  destroyDb(): Promise<void>;
  exit(code: number): void;
  sleep(ms: number): Promise<void>;
}

export const SHUTDOWN_WAIT_MS = 30_000;
// bot.stop() can wait for the network.
export const TELEGRAM_STOP_WAIT_MS = 10_000;

export function createShutdown(steps: () => ShutdownSteps): () => Promise<void> {
  let stopping = false;
  return async () => {
    if (stopping) return;
    stopping = true;
    const s = steps();
    s.stopScheduler();
    // Together with the wait below the sum stays under stop_grace_period (45 s).
    if (s.stopTelegram !== null) {
      await Promise.race([s.stopTelegram().catch(() => undefined), s.sleep(TELEGRAM_STOP_WAIT_MS)]);
    }
    // A kill in the middle of a batch makes the next start count an attempt for each claimed mail. Wait for the batch, but not for ever.
    await Promise.race([s.settled(), s.sleep(SHUTDOWN_WAIT_MS)]);
    await s.stopServer();
    await s.closeWeb();
    await s.destroyDb();
    s.exit(0);
  };
}
