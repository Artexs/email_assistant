import { telegramLockAnswerSchema } from "@ea/core/web";
import { Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { api } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { errorText } from "../../lib/errors";
import { useMe } from "../shell/MeProvider";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Switch } from "../ui/switch";

// The owner's lock of the Telegram detail level (the flag `telegram_minimal`: the server sends `telegramMinimalLocked` only then).
// The owner has the switch; every other role sees the state and cannot change it. The lock changes no stored choice of a member.
export function TelegramLockCard({
  locked,
  isOwnerRole,
  onSaved,
}: {
  locked: boolean;
  isOwnerRole: boolean;
  onSaved(locked: boolean): void;
}) {
  const { me } = useMe();
  const [working, setWorking] = useState(false);
  const pending = working || !canWrite(me);

  const change = async (next: boolean) => {
    setWorking(true);
    try {
      const saved = await api("/api/organization/telegram-lock", telegramLockAnswerSchema, {
        method: "PATCH",
        body: { locked: next },
      });
      onSaved(saved.locked);
      toast.success(t(saved.locked ? "tgl_on_toast" : "tgl_off_toast"));
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setWorking(false);
    }
  };

  return (
    <SectionCard
      data-card="telegram-lock"
      icon={Lock}
      title={t("tgl_title")}
      lead={isOwnerRole ? t("tgl_help") : undefined}
    >
      {isOwnerRole ? (
        <RowList>
          <Row title={t("tgl_label")} htmlFor="tg-lock">
            <Switch id="tg-lock" checked={locked} disabled={pending} onCheckedChange={(next) => void change(next)} />
          </Row>
        </RowList>
      ) : (
        // The help speaks to the owner; the General section already says that only the owner changes the settings.
        <p data-lock={locked ? "on" : "off"} className="text-base font-bold">
          {t(locked ? "tgl_state_on" : "tgl_state_off")}
        </p>
      )}
    </SectionCard>
  );
}
