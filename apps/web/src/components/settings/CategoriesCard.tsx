import {
  noGoBodySchema,
  type BarCategory,
  type GateView,
  type SettingsWebChange,
  type SettingsWebView,
  type TrustView,
} from "@ea/core/web";
import { Filter } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatConfidence, formatPercent, gateText } from "../../lib/gate-text";
import { patchSettings } from "../../lib/settings-api";
import { reportPath } from "../../lib/trust-api";
import { type TrustBlock, type TrustTone, refusalBlocks, showRatingsLine, trustLines } from "../../lib/trust-card";
import { CategoryPill } from "../patterns/CategoryPill";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Switch } from "../ui/switch";
import { SetAnywayDialog } from "./SetAnywayDialog";

export interface CategoriesCardProps {
  settings: SettingsWebView;
  // The trust view of the mailbox. `null`: the flag `trust_ladder` is off or the view did not load: the card is as before the trust ladder.
  trust?: TrustView | null;
  isOwner: boolean;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone: the page reloads its mailbox list.
  onMissing?(): void;
}

const toneClass: Record<TrustTone, string> = {
  ok: "text-foreground",
  warn: "text-muted-foreground",
  muted: "text-muted-foreground",
  bad: "text-destructive",
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
          blocks: refusalBlocks(parsed.success ? parsed.data.blocks : undefined, fallbackBlocks),
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
    <SectionCard
      data-card="categories"
      icon={Filter}
      title={t("cat_title")}
      lead={t("cat_help", { bar: formatPercent(settings.bar), minKept: settings.minKept })}
    >
      <RowList>
        {settings.categories.map((row) => {
          const text = gateText(row.gate, settings.bar, settings.minKept);
          const evidence = trust?.categories[row.category] ?? null;
          const lines = trustLines(row.category, trust);
          // With the view: the switch shows what triage reads now (a category on under another AI model shows off), and the
          // ratings line shows once the user rated enough mails.
          const checked = evidence === null ? row.auto : evidence.auto;
          const blocks = evidence?.evidence.blocks ?? [];
          return (
            <Row
              key={row.category}
              leading={<CategoryPill category={row.category} label={t(`cat_${row.category}`)} />}
              leadingAbove
              title={t(`cat_action_${row.category}`)}
              hint={
                <div className="flex flex-col gap-1">
                  <p>{t(`cat_effect_${row.category}`)}</p>
                  <p>{t("cat_threshold", { value: formatConfidence(row.threshold) })}</p>
                  {(trust === null || showRatingsLine(row.gate.kept, settings.minKept)) && (
                    <p className="text-foreground">{t(text.key, text.vars)}</p>
                  )}
                  {lines.map((line) => (
                    <p key={line.key} data-line={line.key} className={toneClass[line.tone]}>
                      {t(line.key, line.vars)}
                    </p>
                  ))}
                </div>
              }
            >
              <Switch
                aria-label={t("cat_auto_label", { category: t(`cat_${row.category}`) })}
                checked={checked}
                disabled={!isOwner || pending.has(row.category)}
                onCheckedChange={(auto) => void change(row.category, auto, false, row.gate, blocks)}
              />
            </Row>
          );
        })}
      </RowList>
      {trust !== null && trust.check !== null && (
        <a className="text-sm font-bold text-primary underline" href={reportPath(settings.mailboxId)}>
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
    </SectionCard>
  );
}
