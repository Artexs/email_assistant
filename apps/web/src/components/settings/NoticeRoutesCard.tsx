import { notifyViewSchema, type NotifyView } from "@ea/core/web";
import { Route } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { api } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { errorText } from "../../lib/errors";
import {
  currentRouteOf,
  groupLabels,
  hasNoChannel,
  routeGroups,
  routeOptionsOf,
  routesPatchOf,
  routesResetOf,
  type RouteDraft,
  type RouteValue,
} from "../../lib/notice-routes";
import { useMe } from "../shell/MeProvider";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Button } from "../ui/button";

// A native select with the look of the `Input` primitive: the cards of this group use it at the end of a row.
export const selectClass =
  "h-12 min-w-40 max-w-full rounded-md border-2 border-input bg-card px-4 text-base outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

// The own route per notice group (the flag `web_push`). A select that the user did not change sends nothing, so it keeps following
// the default of the server (`routeDefaults`). Any member changes their own row only: the server takes the user from the session.
export function NoticeRoutesCard({ view, onSaved }: { view: NotifyView; onSaved(view: NotifyView): void }) {
  const { me } = useMe();
  const [draft, setDraft] = useState<RouteDraft>({});
  const [working, setWorking] = useState(false);
  const pending = working || !canWrite(me);
  const patch = routesPatchOf(view, draft);
  const reset = routesResetOf(view);

  const send = async (routes: Record<string, string | null>) => {
    setWorking(true);
    try {
      const saved = await api("/api/me/notify", notifyViewSchema, { method: "PATCH", body: { routes } });
      setDraft({});
      toast.success(t("nr_saved_toast"));
      onSaved(saved);
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setWorking(false);
    }
  };

  return (
    <SectionCard data-card="notice-routes" icon={Route} title={t("nr_title")} lead={t("nr_help")}>
      <RowList>
        {routeGroups.map((group) => (
          <Row key={group} title={t(groupLabels[group])} htmlFor={`route-${group}`}>
            <select
              id={`route-${group}`}
              value={draft[group] ?? currentRouteOf(view, group)}
              disabled={pending}
              className={selectClass}
              onChange={(event) => setDraft({ ...draft, [group]: event.target.value as RouteValue })}
            >
              {routeOptionsOf(view, group).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Row>
        ))}
      </RowList>
      {hasNoChannel(view) && <p className="text-sm text-muted-foreground">{t("nr_none_hint")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || patch === null} onClick={() => patch !== null && void send(patch)}>
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending || reset === null}
          onClick={() => reset !== null && void send(reset)}
        >
          {t("nr_use_default")}
        </Button>
      </div>
    </SectionCard>
  );
}
