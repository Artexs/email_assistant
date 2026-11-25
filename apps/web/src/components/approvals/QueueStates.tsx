import { Inbox, PartyPopper } from "lucide-react";

import { t } from "../../i18n";
import { EmptyState } from "../patterns/EmptyState";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";

// The buttons of a card that is closed: sent, rejected, expired, failed, or replaced by a newer version.
export function ClosedActions({
  newest,
  onOpenNewest,
  onGoWaiting,
}: {
  newest: string | undefined;
  onOpenNewest(id: string): void;
  onGoWaiting(): void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {newest !== undefined && (
        <Button type="button" size="lg" onClick={() => onOpenNewest(newest)}>
          {t("appr_open_newest")}
        </Button>
      )}
      <Button type="button" size="lg" variant={newest === undefined ? "default" : "soft"} onClick={onGoWaiting}>
        {t("appr_go_waiting")}
      </Button>
    </div>
  );
}

// A link to a draft that does not exist.
export function MissingCard({ onGoWaiting }: { onGoWaiting(): void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <p>{t("appr_not_found")}</p>
        <Button type="button" size="lg" onClick={onGoWaiting}>
          {t("appr_go_waiting")}
        </Button>
      </CardContent>
    </Card>
  );
}

// Only drafts that the user passed on are left.
export function EndCard({ onShowAgain }: { onShowAgain(): void }) {
  return (
    <Card>
      <CardContent>
        <EmptyState icon={PartyPopper} title={t("appr_end_title")} text={t("appr_end_text")}>
          <Button type="button" size="lg" onClick={onShowAgain}>
            {t("appr_show_again")}
          </Button>
        </EmptyState>
      </CardContent>
    </Card>
  );
}

// Nothing waits for a decision.
export function EmptyQueue() {
  return (
    <EmptyState icon={Inbox} title={t("appr_none")} text={t("appr_empty_text")}>
      <Button asChild>
        <a href="/activity">{t("appr_empty_action")}</a>
      </Button>
    </EmptyState>
  );
}
