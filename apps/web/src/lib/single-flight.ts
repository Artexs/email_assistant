// One request at a time: a second call while the first one runs does nothing and returns undefined.
// The flag is set at once, so a double click is stopped before React re-renders the disabled button.
export function singleFlight(): <T>(task: () => Promise<T>) => Promise<T | undefined> {
  let busy = false;
  return async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    try {
      return await task();
    } finally {
      busy = false;
    }
  };
}
