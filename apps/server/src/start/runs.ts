// The newest run of each scheduled job. Shutdown waits for these runs, so a kill does not cut a batch in the middle.

export interface RunTracker {
  /** The scheduler callback: it starts run(), keeps the newest promise under name, and returns that promise (a rejection reaches the scheduler). */
  track(name: string, run: () => Promise<void>): () => Promise<void>;
  /** Resolves when the newest run of every tracked name has settled (Promise.allSettled). */
  settled(): Promise<void>;
}

export function createRunTracker(): RunTracker {
  const newest = new Map<string, Promise<void>>();
  return {
    track(name, run) {
      return () => {
        const promise = run();
        newest.set(name, promise);
        return promise;
      };
    },
    async settled() {
      await Promise.allSettled([...newest.values()]);
    },
  };
}
