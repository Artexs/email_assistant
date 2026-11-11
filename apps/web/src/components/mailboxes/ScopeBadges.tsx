import type { MailboxView } from "@ea/core/web";

import { t } from "../../i18n/en";
import { badgeKey, reasonKeys } from "../../lib/scope-text";
import { Badge } from "../ui/badge";

export function ScopeBadges({ scopes }: { scopes: MailboxView["scopes"] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{t(badgeKey("triage", scopes.triage.state))}</Badge>
        <Badge variant="outline">{t(badgeKey("actions", scopes.actions.state))}</Badge>
        <Badge variant="outline">{t(badgeKey("send", scopes.send.state))}</Badge>
      </div>
      {reasonKeys(scopes).map((key) => (
        <p key={key} className="text-xs text-muted-foreground">
          {t(key)}
        </p>
      ))}
    </div>
  );
}
