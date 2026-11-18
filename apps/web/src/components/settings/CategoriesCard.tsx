import {
  noGoBodySchema,
  type BarCategory,
  type GateView,
  type SettingsWebChange,
  type SettingsWebView,
  type TrustView,
} from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatConfidence, formatPercent, gateText } from "../../lib/gate-text";
import { patchSettings } from "../../lib/settings-api";
import { reportPath } from "../../lib/trust-api";
import { type TrustBlock, type TrustTone, showRatingsLine, trustLines } from "../../lib/trust-card";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { SetAnywayDialog } from "./SetAnywayDialog";

export interface CategoriesCardProps {
  settings: SettingsWebView;
  // The trust view of the mailbox. `null`: the flag `trust_ladder` is off or the view did not load: the card is as before F110.
  trust?: TrustView | null;
  isOwner: boolean;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone: the page reloads its mailbox list.
  onMissing?(): void;
}

const toneClass: Record<TrustTone, string> = {
  ok: "text-sm",
  warn: "text-sm text-muted-foreground",
  muted: "text-sm text-muted-foreground",
  bad: "text-sm text-destructive",
};

export function CategoriesCard({ settings, trust = null, isOwner, onChanged, onMissing }: CategoriesCardProps) {
  const [pending, setPending] = useState<ReadonlySet<BarCategory>>(new Set());
  const [anyway, setAnyway] = useState<{
    category: BarCategory;
    gate: GateView | null;
    blocks: readonly TrustBlock[];
  } | null>(null);

  const setBusy = (category: BarCategory, busy: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(category);
      else next.delete(category);
      return next;
    });

  // The blocks of the view are the fallback when the 409 body has none (an old answer): the dialog never shows "passed" next to a refusal.
  const change = async (
    category: BarCategory,
    auto: boolean,
    force: boolean,
    fallback: GateView | null,
    fallbackBlocks: readonly TrustBlock[]
  ) => {
    setBusy(category, true);
    try {
      const result = await patchSettings(settings.mailboxId, `/auto/${category}`, force ? { auto, force } : { auto });
      setAnyway(null);
      onChanged(result, auto ? "auto_on_toast" : "auto_off_toast", { category: t(`cat_${category}`) });
    } catch (error) {
      if (error instanceof ApiError && error.code === "no_go" && !force) {
        const parsed = noGoBodySchema.safeParse(error.raw);
        setAnyway({
          category,
          gate: parsed.success ? parsed.data.gate : fallback,
          blocks: parsed.success && parsed.data.blocks !== undefined ? parsed.data.blocks : fallbackBlocks,
        });
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
            const evidence = trust?.categories[row.category] ?? null;
            const lines = trustLines(row.category, trust);
            // With the view: the switch shows what triage reads now (a category on under another AI model shows off), and the
            // ratings line shows once the user rated enough mails.
            const checked = evidence === null ? row.auto : evidence.auto;
            const blocks = evidence?.evidence.blocks ?? [];
            return (
              <li key={row.category} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={t("cat_auto_label", { category: t(`cat_${row.category}`) })}
                    checked={checked}
                    disabled={!isOwner || pending.has(row.category)}
                    onCheckedChange={(auto) => void change(row.category, auto, false, row.gate, blocks)}
                  />
                  <span className="font-medium">{t(`cat_${row.category}`)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("cat_threshold", { value: formatConfidence(row.threshold) })}
                  </span>
                </div>
                {(trust === null || showRatingsLine(row.gate.kept, settings.minKept)) && (
                  <p className="text-sm">{t(text.key, text.vars)}</p>
                )}
                {lines.map((line) => (
                  <p key={line.key} data-line={line.key} className={toneClass[line.tone]}>
                    {t(line.key, line.vars)}
                  </p>
                ))}
                <p className="text-sm text-muted-foreground">{t(`cat_effect_${row.category}`)}</p>
              </li>
            );
          })}
        </ul>
        {trust !== null && trust.check !== null && (
          <a className="text-sm underline" href={reportPath(settings.mailboxId)}>
            {t("trust_report_link")}
          </a>
        )}
        <SetAnywayDialog
          category={anyway?.category ?? null}
          gate={anyway?.gate ?? null}
          blocks={anyway?.blocks ?? []}
          bar={settings.bar}
          minKept={settings.minKept}
          pending={anyway !== null && pending.has(anyway.category)}
          onCancel={() => setAnyway(null)}
          onConfirm={() => {
            if (anyway !== null) void change(anyway.category, true, true, anyway.gate, anyway.blocks);
          }}
        />
      </CardContent>
    </Card>
  );
}
