import { ChevronsUpDown } from "lucide-react";

import { t } from "../../i18n";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface UserMenuProps {
  // `me.user.displayName`. An empty name falls back to the address.
  name: string;
  email: string;
  onLogOut: () => void;
}

// The avatar lies over the left end of the button instead of inside it: its letters are text, and a button whose visible text
// is not part of its accessible name fails the label-in-name rule. The name and the email are in both.
export function UserMenu({ name, email, onLogOut }: UserMenuProps) {
  const shownName = name.trim() === "" ? email : name;
  return (
    <DropdownMenu>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
          <InitialsAvatar name={shownName} size="sm" />
        </span>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto min-h-12 w-full justify-start gap-3 rounded-md py-2 pr-3 pl-14 text-left font-normal has-[>svg]:pr-3 has-[>svg]:pl-14"
            aria-label={t("user_menu_named", { name: shownName, email })}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-bold" title={shownName}>
                {shownName}
              </span>{" "}
              {shownName !== email && (
                <span className="truncate text-xs text-muted-foreground" title={email}>
                  {email}
                </span>
              )}
            </span>
            <ChevronsUpDown />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled>{email}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogOut}>{t("log_out")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
