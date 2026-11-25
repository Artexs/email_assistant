import type { PushDeviceView } from "@ea/core/web";
import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { dateLocale, t, tp, useLocale } from "../../i18n";
import { ApiError } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { errorText } from "../../lib/errors";
import { pushCardParts } from "../../lib/push-card";
import { browserPushDeps, loadPushState, removePushDevice, sendPushTest } from "../../lib/push-api";
import { enablePush, installHint, pushSupported, type PermissionState } from "../../lib/push-client";
import { useResource } from "../../lib/use-resource";
import { useMe } from "../shell/MeProvider";
import { FactBox } from "../patterns/FactBox";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";

// The member's own phone devices (`/api/me/push`): list, turn on notices on this browser, test notice, remove. The card shows only
// with the flag `web_push`. The page holds the PUBLIC VAPID key only; the endpoint and the keys of a subscription go to the server
// and are never shown or kept here.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

interface BrowserFacts {
  supported: boolean;
  permission: PermissionState;
  hint: ReturnType<typeof installHint>;
}

// Read after the first render: the server-side render has no browser.
function readBrowser(): BrowserFacts {
  const supported = pushSupported(globalThis);
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigatorStandalone;
  return {
    supported,
    permission: supported ? (Notification.permission as PermissionState) : "default",
    hint: installHint(navigator.userAgent, standalone),
  };
}

function useInstallPrompt(): InstallPromptEvent | null {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (raised: Event) => {
      raised.preventDefault();
      setEvent(raised as InstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return event;
}

function dayText(iso: string): string {
  return new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" }).format(new Date(iso));
}

function DeviceRow({ device, writable, onRemove }: { device: PushDeviceView; writable: boolean; onRemove(): void }) {
  return (
    <div data-device={device.id} className="contents">
      <Row
        title={device.label}
        hint={
          <>
            <span className="block">{t("push_added", { date: dayText(device.createdAt) })}</span>
            <span className="block">
              {device.lastSuccessAt === null
                ? t("push_never")
                : t("push_last", { date: dayText(device.lastSuccessAt) })}
            </span>
          </>
        }
      >
        {device.thisSession ? <Badge data-badge="this-device">{t("acct_this_device")}</Badge> : null}
        <Button
          type="button"
          variant="destructive-soft"
          size="sm"
          disabled={!writable}
          aria-label={t("push_remove", { label: device.label })}
          onClick={onRemove}
        >
          {t("push_remove_short")}
        </Button>
      </Row>
    </div>
  );
}

export function PushDevicesCard() {
  useLocale();
  const { me } = useMe();
  const writable = canWrite(me);
  const { data, error, loading, reload } = useResource(loadPushState);
  const [browser, setBrowser] = useState<BrowserFacts | null>(null);
  const [pending, setPending] = useState(false);
  const [toRemove, setToRemove] = useState<PushDeviceView | null>(null);
  const installEvent = useInstallPrompt();

  useEffect(() => setBrowser(readBrowser()), []);

  const turnOn = async (publicKey: string) => {
    setPending(true);
    try {
      const result = await enablePush(publicKey, browserPushDeps());
      if (result === "enabled") toast.success(t("push_enabled_toast"));
      else toast.error(t(result === "blocked" ? "push_blocked" : "push_enable_failed"));
      setBrowser(readBrowser());
      reload();
    } finally {
      setPending(false);
    }
  };

  const sendTest = async () => {
    setPending(true);
    try {
      const { sent } = await sendPushTest();
      if (sent > 0) toast.success(tp("push_test_sent", sent));
      else toast.error(t("push_test_none"));
      reload();
    } catch (failure) {
      toast.error(
        failure instanceof ApiError && failure.code === "push_test_limit" ? t("push_test_limit") : t(errorText(failure))
      );
    } finally {
      setPending(false);
    }
  };

  const confirmRemove = async () => {
    if (toRemove === null) return;
    setPending(true);
    try {
      await removePushDevice(toRemove.id);
      toast.success(t("push_removed_toast"));
      setToRemove(null);
      reload();
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setPending(false);
    }
  };

  let body;
  let lead: string | undefined;
  if (data === null) {
    body =
      error !== null && !loading ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t("push_load_error")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <Skeleton aria-busy="true" className="h-16 w-full" />
      );
  } else {
    const parts = pushCardParts({
      vapidPublicKey: data.vapidPublicKey,
      supported: browser?.supported ?? false,
      permission: browser?.permission ?? "default",
      thisDevice: data.devices.some((device) => device.thisSession),
      writable,
    });
    const publicKey = data.vapidPublicKey;
    lead = parts.notSetUp ? undefined : t("push_help");
    body = parts.notSetUp ? (
      <div data-note="not-set-up">
        <FactBox>{t("push_not_set_up")}</FactBox>
      </div>
    ) : (
      <>
        <section data-section="push-devices" className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-muted-foreground">{t("push_devices_title")}</h3>
          {data.devices.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t("push_no_devices")}</p>
          ) : (
            <RowList>
              {data.devices.map((device) => (
                <DeviceRow key={device.id} device={device} writable={writable} onRemove={() => setToRemove(device)} />
              ))}
            </RowList>
          )}
        </section>
        {browser !== null && parts.unsupported && (
          <div data-note="unsupported">
            <FactBox>{t("push_unsupported")}</FactBox>
          </div>
        )}
        {parts.blocked && (
          <p data-note="blocked" role="alert" className="text-sm text-destructive">
            {t("push_blocked")}
          </p>
        )}
        {browser?.hint === "ios" && (
          <div data-note="install-ios">
            <FactBox>{t("push_install_ios")}</FactBox>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {parts.canEnable && publicKey !== null && (
            <Button type="button" disabled={pending} onClick={() => void turnOn(publicKey)}>
              {t("push_enable")}
            </Button>
          )}
          {parts.canTest && (
            <Button type="button" variant="outline" disabled={pending} onClick={() => void sendTest()}>
              {t("push_test")}
            </Button>
          )}
          {installEvent !== null && browser?.hint !== "installed" && browser?.hint !== "ios" && (
            <Button type="button" variant="outline" onClick={() => void installEvent.prompt()}>
              {t("push_install")}
            </Button>
          )}
        </div>
      </>
    );
  }

  return (
    <SectionCard data-card="push-devices" icon={Smartphone} title={t("push_title")} lead={lead}>
      {body}
      <Dialog open={toRemove !== null} onOpenChange={(open) => !open && !pending && setToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("push_remove_title")}</DialogTitle>
            <DialogDescription>{t("push_remove_text")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setToRemove(null)}>
              {t("cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => void confirmRemove()}>
              {t("push_remove_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
