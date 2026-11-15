import type { OAuthBanner as OAuthBannerState } from "../../lib/mail-oauth";
import { t } from "../../i18n";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";

// The result of a sign-in, after the redirect back to `/mailboxes`. A success is a polite status; a failure is an alert.
// The close button lets a keyboard user clear it.
export function OAuthResultBanner({ banner, onClose }: { banner: OAuthBannerState; onClose(): void }) {
  const failed = banner.tone === "error";
  return (
    <Alert variant={failed ? "destructive" : "default"} role={failed ? "alert" : "status"} data-block="oauth-banner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>{t(banner.text)}</p>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </Alert>
  );
}
