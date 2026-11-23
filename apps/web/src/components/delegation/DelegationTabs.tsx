import { cn } from "cn";

import { t, type TextKey } from "../../i18n";

export type DelegationTab = "delegations" | "delegates";

const TABS: { key: DelegationTab; href: `/${DelegationTab}`; label: TextKey }[] = [
  { key: "delegations", href: "/delegations", label: "dlg_tab_delegations" },
  { key: "delegates", href: "/delegates", label: "dlg_tab_delegates" },
];

// The header of the two delegation pages (the delegations dashboard and the delegates list). Delegates is not a nav item: this bar
// is the way between the two pages. Plain links, as the nav: each page is its own address.
export function DelegationTabs({ current }: { current: DelegationTab }) {
  return (
    <nav aria-label={t("dlg_tabs_label")} className="flex gap-1 border-b">
      {TABS.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-9 items-center border-b-2 px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none",
            tab.key === current
              ? "border-primary font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t(tab.label)}
        </a>
      ))}
    </nav>
  );
}
