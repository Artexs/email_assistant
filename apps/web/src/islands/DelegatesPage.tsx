import type { Delegate } from "@ea/core/web";
import { useEffect, useRef, useState } from "react";

import { DelegateAddForm } from "../components/delegation/DelegateAddForm";
import { DelegateEditDialog } from "../components/delegation/DelegateEditDialog";
import { DelegateList, editButtonId, switchId } from "../components/delegation/DelegateList";
import { DelegateOffDialog } from "../components/delegation/DelegateOffDialog";
import { DelegationSwitch } from "../components/delegation/DelegationTabs";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { FactBox } from "../components/patterns/FactBox";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale, type TextKey } from "../i18n";
import { ApiError } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { fetchDelegates, patchDelegate } from "../lib/delegates-api";
import { patchOutcome } from "../lib/delegates-form";
import { singleFlight } from "../lib/single-flight";
import { useResource } from "../lib/use-resource";

// The line under the page head, one live region that holds the text of a result (`info`) or of a failure (`error`). The focus goes to this
// element after a gone delegate, so the text must sit inside it. `name` fills the text.
interface Notice {
  tone: "info" | "error";
  key: TextKey;
  name?: string;
}

function noticeText(notice: Notice | null): string {
  if (notice === null) return "";
  return notice.name === undefined ? t(notice.key) : t(notice.key, { name: notice.name });
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

// Where the focus goes when a dialog closes: the control of the row that opened it, or the status line (the row is gone).
type FocusTarget = "row" | "status";

function Delegates() {
  const { me } = useMe();
  const list = useResource(fetchDelegates);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [flight] = useState(singleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<FocusTarget>("row");
  const [statusTick, setStatusTick] = useState(0);
  // A change with no dialog (the switch) can find the row gone: the row and its switch leave the page, so the focus goes to the status
  // line. The effect runs after the commit that removed them, so nothing takes the focus back.
  useEffect(() => {
    if (statusTick > 0) statusRef.current?.focus();
  }, [statusTick]);

  // The flag is off: the API answers like for an unknown path.
  if (!list.loading && list.error instanceof ApiError && list.error.status === 404) {
    return <FactBox>{t("dlg_off")}</FactBox>;
  }

  const owner = me?.role === "owner";
  const canChange = owner && canWrite(me);
  const items = list.data?.items ?? [];
  const delegateOf = (id: string | null): Delegate | undefined =>
    id === null ? undefined : items.find((delegate) => delegate.id === id);

  // The row is gone (another owner removed it, or the server says so): the list loses it and the status line gets the focus.
  const onGone = (id: string) => {
    focusTarget.current = "status";
    setEditing(null);
    setConfirmOff(null);
    setNotice({ tone: "error", key: "dlg_gone" });
    if (list.data !== null) list.mutate({ items: list.data.items.filter((delegate) => delegate.id !== id) });
    list.reload();
    setStatusTick((tick) => tick + 1);
  };

  const onAdded = (delegate: Delegate) => {
    setNotice({ tone: "info", key: "dlg_added", name: delegate.name });
    list.reload();
  };

  const onSaved = (delegate: Delegate) => {
    focusTarget.current = "row";
    setEditing(null);
    setNotice({ tone: "info", key: "dlg_saved", name: delegate.name });
    list.reload();
  };

  const setActive = (delegate: Delegate, active: boolean) => {
    void flight(async () => {
      setNotice(null);
      try {
        const saved = await patchDelegate(delegate.id, { active });
        focusTarget.current = "row";
        setConfirmOff(null);
        setNotice({ tone: "info", key: saved.active ? "dlg_turned_on" : "dlg_turned_off", name: saved.name });
        list.reload();
      } catch (error) {
        const outcome = patchOutcome(error);
        if (outcome.kind === "gone") {
          onGone(delegate.id);
          return;
        }
        focusTarget.current = "row";
        setConfirmOff(null);
        setNotice({ tone: "error", key: outcome.kind === "error" ? outcome.key : "error_generic" });
      }
    });
  };

  // Turning off asks first; turning on is at once.
  const onToggle = (delegate: Delegate, active: boolean) => {
    if (active) setActive(delegate, true);
    else {
      focusTarget.current = "row";
      setConfirmOff(delegate.id);
    }
  };

  const returnFocus = (target: (id: string) => string, id: string) => {
    if (focusTarget.current === "status") statusRef.current?.focus();
    else document.getElementById(target(id))?.focus();
    focusTarget.current = "row";
  };

  let listContent;
  if (list.data === null) {
    listContent =
      list.error === null || list.loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("dlg_load_error")}</p>
          <Button onClick={list.reload}>{t("retry")}</Button>
        </div>
      );
  } else {
    listContent = (
      <DelegateList
        delegates={items}
        canChange={canChange}
        onEdit={(delegate) => setEditing(delegate.id)}
        onToggle={onToggle}
      />
    );
  }

  const editingDelegate = delegateOf(editing);
  const offDelegate = delegateOf(confirmOff);
  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        tabIndex={-1}
        ref={statusRef}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {notice !== null && (
          <p className={notice.tone === "error" ? "rounded-md border px-4 py-3 text-sm text-destructive" : "text-sm"}>
            {noticeText(notice)}
          </p>
        )}
      </div>
      {canChange && <DelegateAddForm onAdded={onAdded} />}
      {me !== null && !owner && <p className="text-sm text-muted-foreground">{t("dlg_owner_only")}</p>}
      {listContent}
      {editingDelegate !== undefined && (
        <DelegateEditDialog
          delegate={editingDelegate}
          onClose={() => {
            focusTarget.current = "row";
            setEditing(null);
          }}
          onReturnFocus={() => returnFocus(editButtonId, editingDelegate.id)}
          onSaved={onSaved}
          onGone={() => onGone(editingDelegate.id)}
        />
      )}
      {offDelegate !== undefined && (
        <DelegateOffDialog
          delegate={offDelegate}
          onCancel={() => setConfirmOff(null)}
          onConfirm={() => setActive(offDelegate, false)}
          onReturnFocus={() => returnFocus(switchId, offDelegate.id)}
        />
      )}
    </div>
  );
}

export default function DelegatesPage() {
  useLocale();
  return (
    <AppShell
      active="delegations"
      title="title_delegates"
      lead="dlg_lead"
      action={<DelegationSwitch current="delegates" />}
    >
      <Delegates />
    </AppShell>
  );
}
