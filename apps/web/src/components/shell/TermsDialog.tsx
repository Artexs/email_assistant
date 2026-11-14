import { useState } from "react";
import { z } from "zod";

import { getLocale, t, type TextKey } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { legalDocs, legalPath, type LegalDoc } from "../../lib/legal";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

const legalTitles: Record<LegalDoc, TextKey> = {
  terms: "legal_terms_title",
  privacy: "legal_privacy_title",
  dpa: "legal_dpa_title",
};

export interface TermsDialogProps {
  current: string;
  onAccepted: () => void;
  onLogOut: () => void;
}

function keepOpen(event: Event) {
  event.preventDefault();
}

function ignore() {
  // The dialog closes only when the user accepts or logs out.
}

export function TermsDialog({ current, onAccepted, onLogOut }: TermsDialogProps) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lang = getLocale();

  async function accept() {
    setPending(true);
    setFailed(false);
    try {
      await api("/api/me/terms", z.undefined(), { method: "POST", body: { version: current } });
      onAccepted();
    } catch (error) {
      if (error instanceof ApiError && error.code === "terms_outdated") {
        // The page runs an old build: a reload loads the current terms version.
        location.reload();
        return;
      }
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={ignore}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={keepOpen}
        onPointerDownOutside={keepOpen}
        onInteractOutside={keepOpen}
      >
        <DialogHeader>
          <DialogTitle>{t("terms_dialog_title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">{t("terms_dialog_text")}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {legalDocs.map((doc) => (
            <li key={doc}>
              <a href={legalPath(lang, doc)} target="_blank" rel="noopener noreferrer" className="underline">
                {t(legalTitles[doc])}
              </a>
            </li>
          ))}
        </ul>
        {failed && (
          <p role="alert" className="text-destructive text-sm">
            {t("error_generic")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onLogOut}>
            {t("log_out")}
          </Button>
          <Button onClick={() => void accept()} disabled={pending}>
            {pending ? t("terms_dialog_accepting") : t("terms_dialog_accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
