import type { MailboxView } from "@ea/core/web";

import { t } from "../../i18n";
import { mailboxStatusUi } from "../../lib/mailbox-status";
import { Badge } from "../ui/badge";

export function StatusBadge({ status }: { status: MailboxView["status"] }) {
  const ui = mailboxStatusUi[status];
  return <Badge variant={ui.variant}>{t(ui.text)}</Badge>;
}
