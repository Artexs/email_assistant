import { DELEGATE_LIST_MAX, type Delegate } from "@ea/core/web";

import { t } from "../../i18n";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

// The ids that the page uses to give the focus back to a control of a row.
export const editButtonId = (id: string): string => `delegate-edit-${id}`;
export const switchId = (id: string): string => `delegate-switch-${id}`;

export interface DelegateRowProps {
  delegate: Delegate;
  // The owner of an organization that is not suspended: the Edit button shows and the switch works.
  canChange: boolean;
  onEdit(delegate: Delegate): void;
  onToggle(delegate: Delegate, active: boolean): void;
}

// A delegate with no tag shows a word, not an empty list. A long name or address wraps (`break-words`), it never widens the page.
function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <p className="text-sm text-muted-foreground">{t("dlg_tags_none")}</p>;
  return (
    <ul aria-label={t("dlg_tags")} className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="outline" className="max-w-full break-all whitespace-normal">
            {tag}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function DelegateRow({ delegate, canChange, onEdit, onToggle }: DelegateRowProps) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="font-medium break-words">{delegate.name}</p>
        <p className="text-sm break-all text-muted-foreground">{delegate.email}</p>
        <Tags tags={delegate.tags} />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge variant={delegate.active ? "secondary" : "outline"}>
          {t(delegate.active ? "dlg_state_active" : "dlg_state_off")}
        </Badge>
        {canChange && (
          <Button
            id={editButtonId(delegate.id)}
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("dlg_edit_for", { name: delegate.name })}
            onClick={() => onEdit(delegate)}
          >
            {t("dlg_edit")}
          </Button>
        )}
        <Switch
          id={switchId(delegate.id)}
          checked={delegate.active}
          disabled={!canChange}
          aria-label={t("dlg_switch_label", { name: delegate.name })}
          onCheckedChange={(active) => onToggle(delegate, active)}
        />
      </div>
    </li>
  );
}

export interface DelegateListProps extends Omit<DelegateRowProps, "delegate"> {
  delegates: readonly Delegate[];
}

export function DelegateList({ delegates, ...rest }: DelegateListProps) {
  if (delegates.length === 0) return <p className="text-sm text-muted-foreground">{t("dlg_empty")}</p>;
  return (
    <>
      <ul aria-label={t("dlg_list_label")} className="flex flex-col gap-3">
        {delegates.map((delegate) => (
          <DelegateRow key={delegate.id} delegate={delegate} {...rest} />
        ))}
      </ul>
      {/* The API answers at most this many: a full list may hide more (there is no cursor). */}
      {delegates.length >= DELEGATE_LIST_MAX && (
        <p className="text-sm text-muted-foreground">{t("dlg_list_full", { n: DELEGATE_LIST_MAX })}</p>
      )}
    </>
  );
}
