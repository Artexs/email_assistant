import type { ReactNode } from "react";

import { t } from "../../i18n";
import { SETTINGS_GROUPS, type SettingsGroupId } from "../../lib/settings-groups";
import { Button } from "../ui/button";

// One named region of the page. The label is a small muted line, not a heading: the cards are the `h2`.
export function SettingsGroup({ id, children }: { id: SettingsGroupId; children: ReactNode }) {
  const label = SETTINGS_GROUPS.find((group) => group.id === id)?.label;
  return (
    <section id={id} aria-labelledby={`${id}-label`} className="flex scroll-mt-20 flex-col gap-4 lg:scroll-mt-6">
      <p id={`${id}-label`} className="text-sm font-bold text-muted-foreground">
        {label === undefined ? null : t(label)}
      </p>
      {children}
    </section>
  );
}

// Links to the groups. Below `lg` the row wraps above the groups; from `lg` it is a sticky column on the left.
export function SettingsNav() {
  return (
    <nav
      aria-label={t("set_nav_label")}
      className="flex flex-wrap gap-2 lg:sticky lg:top-6 lg:w-56 lg:shrink-0 lg:flex-col lg:items-stretch"
    >
      {SETTINGS_GROUPS.map((group) => (
        <Button key={group.id} asChild variant="soft" size="sm" className="lg:justify-start">
          <a href={`#${group.id}`}>{t(group.label)}</a>
        </Button>
      ))}
    </nav>
  );
}
