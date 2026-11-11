import type { MailboxView } from "@ea/core/web";

import { t } from "../../i18n/en";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface MailboxSelectorProps {
  mailboxes: MailboxView[];
  value: string;
  onChange(id: string): void;
}

export function MailboxSelector({ mailboxes, value, onChange }: MailboxSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="settings-mailbox">{t("set_mailbox_label")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="settings-mailbox" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {mailboxes.map((mailbox) => (
            <SelectItem key={mailbox.id} value={mailbox.id}>
              {mailbox.address}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
