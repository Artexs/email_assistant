import { configureMailHosts } from "../src/modules/mail/host-guard";
import { configureFeatures } from "../src/modules/tenancy/features";
import { setLogFormat } from "../src/platform/log";

import { useWorkerDatabase } from "./worker-db";

// GreenMail runs on 127.0.0.1; the guard tests pass their own policy.
// The CLI tests spawn scripts with this process env (or with no `env`, which inherits it).
process.env.MAIL_ALLOW_LOCAL_HOSTS = "true";
configureMailHosts({ allowLocal: true });

// The tests read console spies in the text form (ADR 0024). A CLI that a test spawns prints text by default.
process.env.LOG_FORMAT = "text";
setLogFormat("text");

// The CLI tests spawn scripts with this process env: no kill list from a developer .env (Bun keeps "" and does not load .env over it).
// A test that spawns a script and needs the worker database passes `env: process.env` (Bun's default is the start environment).
process.env.FEATURES_OFF = "";
configureFeatures({ off: [] });

// `test:int` runs 4 files at once: each worker process gets its own database (F124).
await useWorkerDatabase();
