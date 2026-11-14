import type { SettingsWebChange, SettingsWebView } from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { patchSettings } from "../../lib/settings-api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
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
    <Card data-card="folders">
      <CardHeader>
        <CardTitle>{t("folders_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {settings.syncFolders.map((folder) => (
            <li key={folder.key} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{t(`folder_${folder.key}`)}</span>
                <span className="truncate text-sm text-muted-foreground">{folder.path}</span>
              </div>
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
            </li>
          ))}
        </ul>
        {onlyInbox && <p className="text-sm text-muted-foreground">{t("folders_only_inbox")}</p>}
        <p className="text-sm text-muted-foreground">{t("folders_note")}</p>
      </CardContent>
    </Card>
  );
}
