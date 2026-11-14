import type { MailboxView } from "@ea/core/web";

import { t, type TextKey } from "../../i18n";
import { Badge } from "../ui/badge";

const variants = { active: "default", paused: "secondary", auth_error: "destructive" } as const;
const texts: Record<MailboxView["status"], TextKey> = {
  active: "status_active",
  paused: "status_paused",
  auth_error: "status_auth_error",
};

export function StatusBadge({ status }: { status: MailboxView["status"] }) {
  return <Badge variant={variants[status]}>{t(texts[status])}</Badge>;
}
