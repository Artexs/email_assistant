import { telegramLinkSchema, telegramStateSchema, formatClock, type TelegramLink as LinkState } from "@ea/core/web";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { t } from "../../i18n/en";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useNow } from "../../lib/use-now";
import { useResource } from "../../lib/use-resource";
import { Button, buttonVariants } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";

export interface TelegramLinkProps {
  timeZone: string;
  onChange?: () => void;
}

export function TelegramLink({ timeZone, onChange }: TelegramLinkProps) {
  const [link, setLink] = useState<LinkState | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const now = useNow();
  const { data, loading, reload } = useResource(() => api("/api/channels/telegram", telegramStateSchema), {
    pollMs: link ? 5_000 : 30_000,
  });

  // A link is open and a poll says "linked": the user finished in Telegram. Never on every poll.
  const linked = data?.linked;
  const available = data?.available;
  const linkOpen = link !== null;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (linked && linkOpen) {
      setLink(null);
      onChangeRef.current?.();
    }
    // A link cannot be made while linked, so `linkOpen` alone never fires this.
  }, [linked, linkOpen]);

  // A poll that says "available" clears a `telegram_off` from an earlier 409.
  useEffect(() => {
    if (available === true) setOff(false);
  }, [available]);

  const makeLink = async () => {
    setBusy(true);
    try {
      setLink(await api("/api/channels/telegram/link", telegramLinkSchema, { method: "POST" }));
    } catch (error) {
      if (error instanceof ApiError && error.code === "telegram_off") setOff(true);
      else toast.error(t(errorText(error)));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await api("/api/channels/telegram/link", z.undefined(), { method: "DELETE" });
      setConfirmOpen(false);
      toast.success(t("tg_unlinked_toast"));
      reload();
      onChange?.();
    } catch (error) {
      toast.error(t(errorText(error)));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(t("tg_copied"));
    } catch {
      // A refused clipboard gives no toast: the field stays selectable.
    }
  };

  if (data === null) {
    return loading ? <Skeleton className="h-6 w-48" /> : null;
  }

  if (data.linked) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          {data.linkedAt === null
            ? t("tg_linked")
            : t("tg_linked_since", { date: formatClock(new Date(data.linkedAt), timeZone, now) })}
        </p>
        <Button variant="outline" onClick={() => setConfirmOpen(true)}>
          {t("tg_unlink")}
        </Button>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("tg_unlink_title")}</DialogTitle>
              <DialogDescription>{t("tg_unlink_text")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" disabled={busy} onClick={unlink}>
                {t("tg_unlink")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (off || !data.available) return <p className="text-sm text-muted-foreground">{t("tg_off")}</p>;

  if (data.botUsername === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t("tg_unreachable")}</p>
        <Button variant="outline" onClick={reload}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (link === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">{t("tg_intro")}</p>
        <Button disabled={busy} onClick={makeLink}>
          {t("tg_link")}
        </Button>
      </div>
    );
  }

  const expiresAt = new Date(link.expiresAt);
  if (now >= expiresAt) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t("tg_expired")}</p>
        <Button disabled={busy} onClick={makeLink}>
          {t("tg_new_link")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
        {t("tg_open")}
      </a>
      <div className="flex w-full flex-col gap-1.5">
        <Label htmlFor="tg-link-url">{t("tg_link_label")}</Label>
        <div className="flex gap-2">
          <Input id="tg-link-url" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
          <Button variant="outline" onClick={copy}>
            {t("tg_copy")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("tg_valid_until", { time: formatClock(expiresAt, timeZone, now) })}
      </p>
    </div>
  );
}
