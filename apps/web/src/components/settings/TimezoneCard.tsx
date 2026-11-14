import { organizationViewSchema, type OrganizationSettings, type OrganizationView } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { filterTimeZones } from "../../lib/timezones";
import { useDraft } from "../../lib/use-draft";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface TimezoneCardProps {
  organization: OrganizationSettings;
  isOwner: boolean;
  onSaved(view: OrganizationView): void;
}

export function TimezoneCard({ organization, isOwner, onSaved }: TimezoneCardProps) {
  const current = organization.timezone;
  const { draft, setValue } = useDraft(current);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const selected = draft.value;

  const options = filterTimeZones(organization.timezones, query, current);
  const canSave = isOwner && !pending && selected !== current && options.includes(selected);

  const save = async () => {
    setPending(true);
    try {
      const view = await api("/api/organization", organizationViewSchema, {
        method: "PATCH",
        body: { timezone: selected },
      });
      setInvalid(false);
      toast.success(t("tz_saved_toast", { timezone: view.timezone }));
      onSaved(view);
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 400 &&
        failure.details?.[0]?.message === "timezone_invalid"
      ) {
        setInvalid(true);
      } else {
        toast.error(t(errorText(failure)));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Card data-card="timezone">
      <CardHeader>
        <CardTitle>{t("tz_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="font-medium">{t("tz_current", { timezone: current })}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone-search">{t("tz_search_label")}</Label>
          <Input
            id="timezone-search"
            type="search"
            value={query}
            disabled={!isOwner}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">{t("tz_list_label")}</Label>
          <select
            id="timezone"
            size={8}
            value={selected}
            disabled={!isOwner}
            aria-invalid={invalid}
            className="w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            onChange={(event) => {
              setInvalid(false);
              setValue(event.target.value);
            }}
          >
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {options.length === 0 && <p className="text-sm text-muted-foreground">{t("tz_no_match")}</p>}
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              {t("timezone_invalid")}
            </p>
          )}
        </div>
        {isOwner && (
          <div>
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {t("save")}
            </Button>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{t("tz_note")}</p>
        <p className="text-sm text-muted-foreground">{t("retention_line", { days: organization.retentionDays })}</p>
      </CardContent>
    </Card>
  );
}
