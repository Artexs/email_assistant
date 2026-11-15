// Preload for main-start-log.test.ts: after main.ts has started, a library-style console.error and an uncaught throw.
// The guards that main.ts installs must turn both into events.
setTimeout(() => {
  // eslint-disable-next-line no-console
  console.error("MARKER-WIRING");
}, 2000);
setTimeout(() => {
  throw new Error("MARKER-WIRING");
}, 2500);
