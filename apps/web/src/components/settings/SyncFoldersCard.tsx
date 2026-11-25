import type { SettingsWebChange, SettingsWebView } from "@ea/core/web";
import { FolderSync, Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { patchSettings } from "../../lib/settings-api";
import { FactBox } from "../patterns/FactBox";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Switch } from "../ui/switch";

type FolderKey = SettingsWebView["syncFolders"][number]["key"];

export interface SyncFoldersCardProps {
  settings: SettingsWebView;
  isOwner: boolean;
  onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
  // A 404 means the mailbox is gone: the page reloads its mailbox list.
  onMissing?(): void;
}

export function SyncFoldersCard({ settings, isOwner, onChanged, onMissing }: SyncFoldersCardProps) {
  const [pending, setPending] = useState<ReadonlySet<FolderKey>>(new Set());

  const changeFolder = async (key: FolderKey, enabled: boolean) => {
    setPending((prev) => new Set(prev).add(key));
    try {
      const result = await patchSettings(settings.mailboxId, `/sync-folders/${key}`, { enabled });
      onChanged(result, enabled ? "folder_on_toast" : "folder_off_toast", { folder: t(`folder_${key}`) });
    } catch (error) {
      toast.error(t(errorText(error)));
      if (error instanceof ApiError && error.status === 404) onMissing?.();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const onlyInbox = settings.syncFolders.every((folder) => folder.key === "inbox");

  return (
    <SectionCard data-card="folders" icon={FolderSync} title={t("folders_title")} lead={t("folders_note")}>
      <RowList>
        {settings.syncFolders.map((folder) => (
          <Row
            key={folder.key}
            title={t(`folder_${folder.key}`)}
            hint={<span className="block truncate">{folder.path}</span>}
          >
            {folder.key === "inbox" ? (
              <span className="text-sm text-muted-foreground">{t("folders_always")}</span>
            ) : (
              <Switch
                aria-label={t(`folder_${folder.key}`)}
                checked={folder.enabled}
                disabled={!isOwner || pending.has(folder.key)}
                onCheckedChange={(enabled) => void changeFolder(folder.key, enabled)}
              />
            )}
          </Row>
        ))}
      </RowList>
      {onlyInbox && <FactBox icon={Info}>{t("folders_only_inbox")}</FactBox>}
    </SectionCard>
  );
}
