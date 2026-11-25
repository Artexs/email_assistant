import { digestTimesBodySchema, digestTimesSchema, MAX_DIGEST_TIMES } from "@ea/core/web";
import { Clock, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { isDirty } from "../../lib/draft";
import { errorText } from "../../lib/errors";
import { useDraft } from "../../lib/use-draft";
import { useMe } from "../shell/MeProvider";
import { SectionCard } from "../patterns/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const timeErrors: readonly TextKey[] = ["time_invalid", "times_too_many", "times_duplicate"];

export interface DigestTimesCardProps {
  // The member's own times (`useMe().me.digestTimes`).
  times: string[];
  timeZone: string;
  onSaved(): void;
}

export function DigestTimesCard({ times, timeZone, onSaved }: DigestTimesCardProps) {
  const { draft, setValue, reset } = useDraft(times);
  const { me } = useMe();
  const [pendingSave, setPending] = useState(false);
  // A paused organization takes no write: every control is off.
  const pending = pendingSave || !canWrite(me);
  const [error, setError] = useState<TextKey | null>(null);
  const rows = draft.value;

  const edit = (next: string[]) => {
    setError(null);
    setValue(next);
  };

  const save = async () => {
    const parsed = digestTimesBodySchema.safeParse({ times: rows.filter((row) => row !== "") });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      setError(timeErrors.find((key) => key === message) ?? "error_generic");
      return;
    }
    setPending(true);
    try {
      const saved = await api("/api/me/digest-times", digestTimesSchema, {
        method: "PATCH",
        body: { times: parsed.data.times },
      });
      reset(saved.times);
      setError(null);
      toast.success(t("digest_saved_toast"));
      onSaved();
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setPending(false);
    }
  };

  return (
    <SectionCard
      data-card="digest"
      icon={Clock}
      title={t("digest_title")}
      lead={t("digest_help", { timezone: timeZone, max: MAX_DIGEST_TIMES })}
    >
      {rows.length === 0 && <p className="text-sm">{t("digest_none")}</p>}
      <ul className="flex flex-wrap items-center gap-2">
        {rows.map((row, index) => (
          // The rows have no id of their own; a controlled input row is safe to key by its place.
          <li key={index}>
            <Badge className="h-12 gap-1 overflow-visible border-input py-0 pr-1 pl-2 text-base">
              <Input
                type="time"
                step={60}
                value={row}
                aria-label={t("digest_time_label", { n: index + 1 })}
                disabled={pending}
                aria-invalid={error !== null}
                className="h-9 w-36 border-0 bg-transparent px-2 text-primary"
                onChange={(event) => edit(rows.map((item, at) => (at === index ? event.target.value : item)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={pending}
                aria-label={row === "" ? t("digest_remove_new") : t("digest_remove", { time: row })}
                onClick={() => edit(rows.filter((_, at) => at !== index))}
              >
                <X aria-hidden="true" />
              </Button>
            </Badge>
          </li>
        ))}
        <li>
          <Button
            type="button"
            variant="soft"
            size="icon"
            disabled={pending || rows.length >= MAX_DIGEST_TIMES}
            aria-label={t("digest_add")}
            onClick={() => edit([...rows, ""])}
          >
            <Plus aria-hidden="true" />
          </Button>
        </li>
      </ul>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("digest_new_time_note")}</p>
      <div>
        <Button type="button" disabled={pending || !isDirty(draft)} onClick={() => void save()}>
          {t("save")}
        </Button>
      </div>
    </SectionCard>
  );
}
