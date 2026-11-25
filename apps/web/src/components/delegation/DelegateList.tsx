import { DELEGATE_LIST_MAX, type Delegate } from "@ea/core/web";
import { Users } from "lucide-react";

import { t } from "../../i18n";
import { EmptyState } from "../patterns/EmptyState";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
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

// One card per delegate: the avatar, the name and address, the tags, then the state, Edit and the switch.
export function DelegateRow({ delegate, canChange, onEdit, onToggle }: DelegateRowProps) {
  return (
    <li className="min-w-0">
      <Card className="h-full gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <InitialsAvatar name={delegate.name} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-bold break-words">{delegate.name}</p>
            <p className="text-sm break-all text-muted-foreground">{delegate.email}</p>
          </div>
        </div>
        <Tags tags={delegate.tags} />
        <div className="mt-auto flex flex-wrap items-center gap-3">
          <Badge variant={delegate.active ? "default" : "outline"}>
            {t(delegate.active ? "dlg_state_active" : "dlg_state_off")}
          </Badge>
          <div className="ml-auto flex items-center gap-3">
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
        </div>
      </Card>
    </li>
  );
}

export interface DelegateListProps extends Omit<DelegateRowProps, "delegate"> {
  delegates: readonly Delegate[];
}

export function DelegateList({ delegates, ...rest }: DelegateListProps) {
  if (delegates.length === 0) {
    // Only an owner who can write has the form to point at.
    return <EmptyState icon={Users} title={t("dlg_empty")} text={rest.canChange ? t("dlg_empty_text") : undefined} />;
  }
  return (
    <>
      <ul aria-label={t("dlg_list_label")} className="grid gap-4 lg:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
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
