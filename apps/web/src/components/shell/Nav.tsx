import { Menu } from "lucide-react";
import { cn } from "cn";

import { t } from "../../i18n";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import {
  approvalsBadge,
  navItems,
  ONBOARDING_ITEM,
  OPERATOR_ITEM,
  phoneOverflow,
  phoneTabs,
  type NavItem,
  type NavKey,
} from "./nav-items";
import { BrandMark } from "./BrandMark";
import { UserMenu } from "./UserMenu";
import { HelpLink } from "./WhatsNew";

export interface NavMenuProps {
  active: NavKey;
  onboardingOpen: boolean;
  operator: boolean;
  features: readonly string[];
  // `me.approvalsWaiting`: the count on the badge of the approvals item.
  approvalsWaiting: number;
  // `me.user.displayName` and `me.user.email`; both null until `me` came (a caller that has no name leaves it out).
  name?: string | null;
  email: string | null;
  loading: boolean;
  onLogOut: () => void;
}

// Fixed class names: Tailwind builds only the names that appear whole in the source.
const TAB_COLUMNS: Record<number, string> = { 4: "grid-cols-4", 5: "grid-cols-5" };

// The count of the approvals item: the number is for the eye (`Badge`), the text after the label for a screen reader (`BadgeText`),
// so the link reads "Approvals 1 waiting". Nothing at 0.
function badgeOf(item: NavItem, count: number): string | null {
  return item.key === "approvals" ? approvalsBadge(count) : null;
}

function Badge({ item, count, className }: { item: NavItem; count: number; className: string }) {
  const text = badgeOf(item, count);
  if (text === null) return null;
  return (
    <span
      aria-hidden="true"
      className={cn("rounded-full bg-primary px-1.5 text-[0.7rem] leading-4 text-primary-foreground", className)}
    >
      {text}
    </span>
  );
}

function BadgeText({ item, count }: { item: NavItem; count: number }) {
  const text = badgeOf(item, count);
  return text === null ? null : <span className="sr-only">{t("nav_approvals_badge", { n: text })}</span>;
}

export function BottomTabs({
  active,
  features,
  approvalsWaiting,
}: {
  active: NavKey;
  features: readonly string[];
  approvalsWaiting: number;
}) {
  const items = phoneTabs(features);
  return (
    <nav
      aria-label={t("nav_main")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid h-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))] border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden",
        TAB_COLUMNS[items.length] ?? "grid-cols-4"
      )}
    >
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-xs leading-tight font-bold wrap-anywhere hyphens-auto",
            item.key === active ? "text-primary" : "text-muted-foreground"
          )}
        >
          <span className="relative">
            <item.icon className="size-5" aria-hidden="true" />
            <Badge item={item} count={approvalsWaiting} className="absolute -top-1 left-1.5" />
          </span>
          <span>{t(item.label)}</span>
          <BadgeText item={item} count={approvalsWaiting} />
        </a>
      ))}
    </nav>
  );
}

function SidebarLink({ item, active, approvalsWaiting }: { item: NavItem; active: NavKey; approvalsWaiting: number }) {
  return (
    <a
      href={item.href}
      aria-current={item.key === active ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-md px-3.5 py-2 text-sm font-semibold",
        item.key === active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted"
      )}
    >
      <item.icon className="size-5 shrink-0" aria-hidden="true" />
      <span>{t(item.label)}</span>
      <Badge item={item} count={approvalsWaiting} className="ml-auto" />
      <BadgeText item={item} count={approvalsWaiting} />
    </a>
  );
}

export function Sidebar({
  active,
  onboardingOpen,
  operator,
  features,
  approvalsWaiting,
  name,
  email,
  loading,
  onLogOut,
}: NavMenuProps) {
  const base = navItems(features);
  const tabs = onboardingOpen ? [ONBOARDING_ITEM, ...base] : base;
  const items = operator ? [...tabs, OPERATOR_ITEM] : tabs;
  return (
    <aside className="hidden min-h-0 flex-col rounded-xl bg-sidebar px-3.5 py-5 shadow-card forced-colors:border lg:sticky lg:top-5 lg:flex lg:h-[calc(100dvh-2.5rem)]">
      <div className="flex items-center gap-2.5 px-2.5 pb-4">
        <BrandMark />
        <p className="text-lg font-extrabold">{t("brand")}</p>
      </div>
      <nav aria-label={t("nav_main")} className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-1">
        {items.map((item) => (
          <SidebarLink key={item.key} item={item} active={active} approvalsWaiting={approvalsWaiting} />
        ))}
      </nav>
      <div className="flex flex-col gap-1 pt-3">
        {features.includes("docs_links") && (
          <HelpLink className="flex min-h-12 items-center rounded-md px-3.5 text-sm font-semibold text-muted-foreground hover:bg-muted" />
        )}
        {email !== null ? (
          <UserMenu name={name ?? ""} email={email} onLogOut={onLogOut} />
        ) : loading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <Button variant="ghost" className="w-full justify-start" onClick={onLogOut}>
            {t("log_out")}
          </Button>
        )}
      </div>
    </aside>
  );
}

// On a phone the menu also holds the items that do not fit in the tab bar.
export function MenuSheet({
  active,
  onboardingOpen,
  operator,
  features,
  approvalsWaiting,
  name,
  email,
  loading,
  onLogOut,
}: NavMenuProps) {
  const shownName = name === undefined || name === null || name.trim() === "" ? email : name;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("menu_open")}>
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{t("menu_title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("nav_main")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 px-4 pb-4">
          {onboardingOpen && <SidebarLink item={ONBOARDING_ITEM} active={active} approvalsWaiting={0} />}
          {phoneOverflow(features).map((item) => (
            <SidebarLink key={item.key} item={item} active={active} approvalsWaiting={approvalsWaiting} />
          ))}
          {operator && <SidebarLink item={OPERATOR_ITEM} active={active} approvalsWaiting={0} />}
          <div className="mt-auto flex flex-col gap-3">
            {features.includes("docs_links") && <HelpLink className="text-sm underline" />}
            {email !== null && shownName !== null ? (
              <div className="flex items-center gap-3 px-1">
                <InitialsAvatar name={shownName} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-bold" title={shownName}>
                    {shownName}
                  </p>
                  {shownName !== email && (
                    <p className="truncate text-xs text-muted-foreground" title={email}>
                      {email}
                    </p>
                  )}
                </div>
              </div>
            ) : loading ? (
              <Skeleton className="h-10 w-full" />
            ) : null}
            <Button variant="outline" onClick={onLogOut}>
              {t("log_out")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
