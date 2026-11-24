import { installWorker, type ShellFiles, type WorkerScope } from "../lib/service-worker";

// Entry of the service worker. `scripts/build-sw.ts` bundles it to `dist/sw.js` (scope `/`) and fills `__EA_SHELL__` with the files of
// the offline page.
declare const __EA_SHELL__: ShellFiles;

installWorker(self as unknown as WorkerScope, __EA_SHELL__);
