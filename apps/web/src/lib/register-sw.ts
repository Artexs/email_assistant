// Registers the service worker of the panel (scope `/`). The build writes `/sw.js`; the dev server has none, so nothing registers there.
// A failure is not an error for the user: the panel works without the worker.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}
