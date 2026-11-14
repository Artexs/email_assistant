export interface PollDoc {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PollTimers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

// Runs `run` once now; repeats it every `pollMs` while the document is visible; returns stop().
// A `pollMs` of 0 or less runs it once and never repeats.
export function startPolling(run: () => void, opts: { pollMs: number; doc: PollDoc; timers: PollTimers }): () => void {
  const { pollMs, doc, timers } = opts;
  if (pollMs <= 0) {
    run();
    return () => undefined;
  }
  let timer: unknown;
  let running = false;

  const clear = () => {
    if (running) timers.clearInterval(timer);
    running = false;
    timer = undefined;
  };
  const start = () => {
    clear();
    timer = timers.setInterval(run, pollMs);
    running = true;
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") {
      run();
      start();
    } else {
      clear();
    }
  };

  run();
  if (doc.visibilityState === "visible") start();
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    clear();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
