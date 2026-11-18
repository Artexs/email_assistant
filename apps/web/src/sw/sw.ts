import { installWorker, type WorkerScope } from "../lib/service-worker";

// Entry of the service worker. `scripts/build-sw.ts` bundles it to `dist/sw.js` (scope `/`).
installWorker(self as unknown as WorkerScope);
