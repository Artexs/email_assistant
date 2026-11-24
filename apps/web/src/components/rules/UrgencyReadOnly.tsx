import type { SettingsWebView } from "@ea/core/web";

import { t } from "../../i18n";
import { vipCardId } from "../../lib/rules-view";
import { isEnded } from "../../lib/urgency-form";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";

// VIP people are sender rules of kind `vip`: the card keeps no second list.
export function VipLine() {
  return (
    <p className="text-sm text-muted-foreground">
      {t("urg_vip_text")}{" "}
      <a className="underline" href={`#${vipCardId}`}>
        {t("urg_vip_link")}
      </a>
    </p>
  );
}

interface ReadOnlyProps {
  settings: SettingsWebView;
  timeZone: string;
  now: Date;
}

// A member (or a paused account) sees the profile and no control.
export function UrgencyReadOnly({ settings, timeZone, now }: ReadOnlyProps) {
  const profile = settings.urgencyProfile;
  const topics = profile?.topics ?? [];
  const deadlines = profile?.deadlines ?? [];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="urg-topics-title" className="flex flex-col gap-2">
        <h3 id="urg-topics-title" className="text-base font-bold">
          {t("urg_topics_title")}
        </h3>
        {topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("urg_topics_empty")}</p>
        ) : (
          <RowList>
            {topics.map((topic, index) => (
              <Row
                key={index}
                title={topic.label}
                hint={topic.keywords.length > 0 ? topic.keywords.join(", ") : undefined}
              />
            ))}
          </RowList>
        )}
      </section>
      <section aria-labelledby="urg-deadlines-title" className="flex flex-col gap-2">
        <h3 id="urg-deadlines-title" className="text-base font-bold">
          {t("urg_deadlines_title")}
        </h3>
        {deadlines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("urg_deadlines_empty")}</p>
        ) : (
          <RowList>
            {deadlines.map((deadline, index) => {
              const ended = isEnded(deadline.due, now, timeZone);
              return (
                <div key={index} data-ended={ended ? "true" : undefined}>
                  <Row
                    title={deadline.label}
                    hint={
                      <>
                        <span className={ended ? "line-through" : ""}>{deadline.due}</span>
                        {ended && <span> · {t("urg_ended")}</span>}
                      </>
                    }
                  />
                </div>
              );
            })}
          </RowList>
        )}
      </section>
      <VipLine />
    </div>
  );
}
