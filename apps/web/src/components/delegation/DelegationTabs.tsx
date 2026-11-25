import { t, type TextKey } from "../../i18n";
import { useMe } from "../shell/MeProvider";
import { PillNav } from "./PillNav";

export type DelegationTab = "delegations" | "delegates";

const TABS: { key: DelegationTab; href: `/${DelegationTab}`; label: TextKey }[] = [
  { key: "delegations", href: "/delegations", label: "dlg_tab_delegations" },
  { key: "delegates", href: "/delegates", label: "dlg_tab_delegates" },
];

// The switch between the two delegation pages (the delegations dashboard and the delegates list). Delegates is not a nav item: this
// switch is the way between the two pages. Plain links, as the nav: each page is its own address.
export function DelegationTabs({ current }: { current: DelegationTab }) {
  const items = TABS.map((tab) => ({ key: tab.key, href: tab.href, label: t(tab.label) }));
  return <PillNav label={t("dlg_tabs_label")} items={items} current={current} />;
}

// The switch as the action of a page head. Without the flag `delegation_pages` the pages answer "off", so nothing shows.
export function DelegationSwitch({ current }: { current: DelegationTab }) {
  const { me } = useMe();
  return me?.features.includes("delegation_pages") === true ? <DelegationTabs current={current} /> : null;
}
