import { configureMailHosts } from "../src/modules/mail/host-guard";

// GreenMail runs on 127.0.0.1; the guard tests pass their own policy.
// The CLI tests spawn scripts with this process env (or with no `env`, which inherits it).
process.env.MAIL_ALLOW_LOCAL_HOSTS = "true";
configureMailHosts({ allowLocal: true });
