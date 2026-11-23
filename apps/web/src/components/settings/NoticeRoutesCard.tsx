import { notifyViewSchema, type NotifyView } from "@ea/core/web";
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
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";

const selectClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

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
    <Card data-card="notice-routes">
      <CardHeader>
        <CardTitle>{t("nr_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("nr_help")}</p>
        <div className="flex flex-wrap gap-4">
          {routeGroups.map((group) => (
            <div key={group} className="flex min-w-40 flex-1 flex-col gap-1.5">
              <Label htmlFor={`route-${group}`}>{t(groupLabels[group])}</Label>
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
            </div>
          ))}
        </div>
        {hasNoChannel(view) && <p className="text-sm text-muted-foreground">{t("nr_none_hint")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || patch === null} onClick={() => patch !== null && void send(patch)}>
            {t("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || reset === null}
            onClick={() => reset !== null && void send(reset)}
          >
            {t("nr_use_default")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
