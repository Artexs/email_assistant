import { organizationViewSchema, type OrganizationSettings, type OrganizationView } from "@ea/core/web";
import { Globe } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { t } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { filterTimeZones } from "../../lib/timezones";
import { useDraft } from "../../lib/use-draft";
import { SectionCard } from "../patterns/SectionCard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { selectClass } from "./NoticeRoutesCard";

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
    <SectionCard data-card="timezone" icon={Globe} title={t("tz_title")} lead={t("tz_current", { timezone: current })}>
      {/* The search field and the list sit full width under their labels: a list of eight lines needs the room. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone-search" className="text-base font-bold">
          {t("tz_search_label")}
        </Label>
        <Input
          id="timezone-search"
          type="search"
          value={query}
          disabled={!isOwner}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone" className="text-base font-bold">
          {t("tz_list_label")}
        </Label>
        <select
          id="timezone"
          size={8}
          value={selected}
          disabled={!isOwner}
          aria-invalid={invalid}
          className={cn(
            selectClass,
            "h-auto w-full p-1.5 [&_option]:rounded-sm [&_option]:px-3 [&_option]:py-1.5 [&_option:checked]:bg-primary-soft [&_option:checked]:font-bold [&_option:checked]:text-primary"
          )}
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
      </div>
      {options.length === 0 && <p className="text-sm text-muted-foreground">{t("tz_no_match")}</p>}
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t("timezone_invalid")}
        </p>
      )}
      {isOwner && (
        <div>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {t("save")}
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{t("tz_note")}</p>
      <p className="text-sm text-muted-foreground">{t("retention_line", { days: organization.retentionDays })}</p>
    </SectionCard>
  );
}
