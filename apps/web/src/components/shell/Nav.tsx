import { Menu } from "lucide-react";
import { cn } from "cn";

import { t } from "../../i18n/en";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { ONBOARDING_ITEM, TAB_ITEMS, type NavItem, type NavKey } from "./nav-items";
import { UserMenu } from "./UserMenu";

export interface NavMenuProps {
  active: NavKey;
  onboardingOpen: boolean;
  email: string | null;
  loading: boolean;
  onLogOut: () => void;
}

export function BottomTabs({ active }: { active: NavKey }) {
  return (
    <nav
      aria-label={t("nav_main")}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background lg:hidden"
    >
      {TAB_ITEMS.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={cn(
            "flex flex-col items-center gap-1 py-2 text-xs",
            item.key === active ? "font-semibold text-foreground" : "text-muted-foreground"
          )}
        >
          <item.icon className="size-5" aria-hidden="true" />
          <span>{t(item.label)}</span>
        </a>
      ))}
    </nav>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: NavKey }) {
  return (
    <a
      href={item.href}
      aria-current={item.key === active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
        item.key === active ? "bg-accent font-medium" : "text-muted-foreground"
      )}
    >
      <item.icon className="size-4" aria-hidden="true" />
      <span>{t(item.label)}</span>
    </a>
  );
}

export function Sidebar({ active, onboardingOpen, email, loading, onLogOut }: NavMenuProps) {
  const items = onboardingOpen ? [ONBOARDING_ITEM, ...TAB_ITEMS] : TAB_ITEMS;
  return (
    <aside className="hidden border-r lg:flex lg:flex-col">
      <p className="px-6 py-4 text-lg font-semibold">{t("brand")}</p>
      <nav aria-label={t("nav_main")} className="flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => (
          <SidebarLink key={item.key} item={item} active={active} />
        ))}
      </nav>
      <div className="border-t p-3">
        {email !== null ? (
          <UserMenu email={email} onLogOut={onLogOut} />
        ) : loading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Button variant="ghost" className="w-full justify-start" onClick={onLogOut}>
            {t("log_out")}
          </Button>
        )}
      </div>
    </aside>
  );
}

export function MenuSheet({ active, onboardingOpen, email, loading, onLogOut }: NavMenuProps) {
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
          {onboardingOpen && <SidebarLink item={ONBOARDING_ITEM} active={active} />}
          <div className="mt-auto flex flex-col gap-3">
            {email !== null ? (
              <p className="truncate text-sm" title={email}>
                {email}
              </p>
            ) : loading ? (
              <Skeleton className="h-5 w-full" />
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
