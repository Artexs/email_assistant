import {
  noGoBodySchema,
  type BarCategory,
  type GateView,
  type SettingsWebChange,
  type SettingsWebView,
} from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n/en";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatConfidence, formatPercent, gateText } from "../../lib/gate-text";
import { patchSettings } from "../../lib/settings-api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { SetAnywayDialog } from "./SetAnywayDialog";

export interface CategoriesCardProps {
  settings: SettingsWebView;
  isOwner: boolean;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone: the page reloads its mailbox list.
  onMissing?(): void;
}

export function CategoriesCard({ settings, isOwner, onChanged, onMissing }: CategoriesCardProps) {
  const [pending, setPending] = useState<ReadonlySet<BarCategory>>(new Set());
  const [anyway, setAnyway] = useState<{ category: BarCategory; gate: GateView | null } | null>(null);

  const setBusy = (category: BarCategory, busy: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(category);
      else next.delete(category);
      return next;
    });

  const change = async (category: BarCategory, auto: boolean, force: boolean, fallback: GateView | null) => {
    setBusy(category, true);
    try {
      const result = await patchSettings(settings.mailboxId, `/auto/${category}`, force ? { auto, force } : { auto });
      setAnyway(null);
      onChanged(result, auto ? "auto_on_toast" : "auto_off_toast", { category: t(`cat_${category}`) });
    } catch (error) {
      if (error instanceof ApiError && error.code === "no_go" && !force) {
        const parsed = noGoBodySchema.safeParse(error.raw);
        setAnyway({ category, gate: parsed.success ? parsed.data.gate : fallback });
      } else {
        toast.error(t(errorText(error)));
        if (error instanceof ApiError && error.status === 404) onMissing?.();
      }
    } finally {
      setBusy(category, false);
    }
  };

  return (
    <Card data-card="categories">
      <CardHeader>
        <CardTitle>{t("cat_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("cat_help", { bar: formatPercent(settings.bar), minKept: settings.minKept })}
        </p>
        <ul className="flex flex-col gap-4">
          {settings.categories.map((row) => {
            const text = gateText(row.gate, settings.bar, settings.minKept);
            return (
              <li key={row.category} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={t("cat_auto_label", { category: t(`cat_${row.category}`) })}
                    checked={row.auto}
                    disabled={!isOwner || pending.has(row.category)}
                    onCheckedChange={(auto) => void change(row.category, auto, false, row.gate)}
                  />
                  <span className="font-medium">{t(`cat_${row.category}`)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("cat_threshold", { value: formatConfidence(row.threshold) })}
                  </span>
                </div>
                <p className="text-sm">{t(text.key, text.vars)}</p>
                <p className="text-sm text-muted-foreground">{t(`cat_effect_${row.category}`)}</p>
              </li>
            );
          })}
        </ul>
        <SetAnywayDialog
          category={anyway?.category ?? null}
          gate={anyway?.gate ?? null}
          bar={settings.bar}
          minKept={settings.minKept}
          pending={anyway !== null && pending.has(anyway.category)}
          onCancel={() => setAnyway(null)}
          onConfirm={() => {
            if (anyway !== null) void change(anyway.category, true, true, anyway.gate);
          }}
        />
      </CardContent>
    </Card>
  );
}
