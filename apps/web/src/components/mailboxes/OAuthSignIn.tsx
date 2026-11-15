import type { MailOAuthProviderKey } from "@ea/core/web";

import { t, type TextKey } from "../../i18n";
import { providerButtonText } from "../../lib/mail-oauth";
import { Button } from "../ui/button";

export interface OAuthSignInProps {
  // The providers the server lets this organization connect (`connectProviders`). Empty: nothing renders.
  providers: readonly MailOAuthProviderKey[];
  disabled: boolean;
  error: TextKey | null;
  onStart(provider: MailOAuthProviderKey): void;
}

// The sign-in buttons above the password form of the connect dialog. A provider that is off has no button, and the
// "Or connect with a password" line shows only with a button above it. The buttons are `type="button"`: Enter in the
// password form never starts a sign-in. The Google hint is the description of the Google button.
export function OAuthSignIn({ providers, disabled, error, onStart }: OAuthSignInProps) {
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-block="oauth">
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-describedby={provider === "google" ? "connect-oauth-google-hint" : undefined}
            onClick={() => onStart(provider)}
          >
            {t(providerButtonText[provider])}
          </Button>
        ))}
      </div>
      {providers.includes("google") && (
        <p id="connect-oauth-google-hint" className="text-sm text-muted-foreground">
          {t("oauth_google_hint")}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <p className="text-sm font-medium">{t("oauth_or_password")}</p>
    </div>
  );
}
