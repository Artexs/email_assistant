import { ChevronsUpDown } from "lucide-react";

import { t } from "../../i18n";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface UserMenuProps {
  email: string;
  onLogOut: () => void;
}

export function UserMenu({ email, onLogOut }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-between" aria-label={t("user_menu")}>
          <span className="truncate" title={email}>
            {email}
          </span>
          <ChevronsUpDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled>{email}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogOut}>{t("log_out")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
