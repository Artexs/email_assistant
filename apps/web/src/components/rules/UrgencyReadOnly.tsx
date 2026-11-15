import type { SettingsWebView } from "@ea/core/web";

import { t } from "../../i18n";
import { vipCardId } from "../../lib/rules-view";
import { isEnded } from "../../lib/urgency-form";

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
        <h3 id="urg-topics-title" className="font-medium">
          {t("urg_topics_title")}
        </h3>
        {topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("urg_topics_empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {topics.map((topic, index) => (
              <li key={index}>
                <span className="font-medium">{topic.label}</span>
                {topic.keywords.length > 0 && (
                  <span className="text-sm text-muted-foreground"> · {topic.keywords.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="urg-deadlines-title" className="flex flex-col gap-2">
        <h3 id="urg-deadlines-title" className="font-medium">
          {t("urg_deadlines_title")}
        </h3>
        {deadlines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("urg_deadlines_empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {deadlines.map((deadline, index) => {
              const ended = isEnded(deadline.due, now, timeZone);
              return (
                <li key={index} data-ended={ended ? "true" : undefined}>
                  <span className={`font-medium ${ended ? "line-through" : ""}`}>{deadline.label}</span>
                  <span className={`text-sm text-muted-foreground ${ended ? "line-through" : ""}`}>
                    {" "}
                    · {deadline.due}
                  </span>
                  {ended && <span className="text-sm text-muted-foreground"> · {t("urg_ended")}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <VipLine />
    </div>
  );
}
