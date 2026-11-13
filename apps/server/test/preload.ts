import { configureMailHosts } from "../src/modules/mail/host-guard";
import { setLogFormat } from "../src/platform/log";

// GreenMail runs on 127.0.0.1; the guard tests pass their own policy.
// The CLI tests spawn scripts with this process env (or with no `env`, which inherits it).
process.env.MAIL_ALLOW_LOCAL_HOSTS = "true";
configureMailHosts({ allowLocal: true });

// The tests read console spies in the text form (ADR 0024, F089). A CLI that a test spawns prints text by default (D11).
process.env.LOG_FORMAT = "text";
setLogFormat("text");
