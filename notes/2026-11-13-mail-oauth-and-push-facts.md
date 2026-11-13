# Mail OAuth (Microsoft 365, Gmail) and Web Push: external facts (2026-11-13)

Collected in the E9 discovery session (`docs/product/stage-2/epics/E09-reach.md`). Check again if older than about 3 months.
Vendor pages that sell a product are marked "marketing". Google OAuth facts from 2026-11-02 are in `notes/2026-11-02-external-facts-gmail-gemini-telegram.md` (testing mode 7-day expiry, 100 users, internal apps, admin-trusted apps).

## Microsoft 365 (Exchange Online)

- IMAP capability of `outlook.office365.com:993`: `IMAP4 IMAP4rev1 AUTH=PLAIN AUTH=XOAUTH2 SASL-IR UIDPLUS MOVE ID UNSELECT CHILDREN IDLE NAMESPACE LITERAL+`. No CONDSTORE and no SPECIAL-USE in that list. — https://stackoverflow.com/questions/65690142 (answer by arnt; old, check in the spike)
- "By default, POP3 and IMAP4 are enabled for all users in Exchange Online." "If you've enabled security defaults in your organization, POP3 and IMAP4 are automatically disabled in Exchange Online." — https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/pop3-and-imap4 (page updated 2024-02-07). The page does not say whether this also blocks OAuth IMAP. **The spike must check this on a tenant with security defaults on.**
- Security defaults: "If your tenant was created on or after October 22, 2019, security defaults might be enabled in your tenant." "After security defaults are enabled in your tenant, all authentication requests made by an older protocol will be blocked." The page names IMAP, SMTP and POP3 as older protocols. It does not separate OAuth from Basic. — https://learn.microsoft.com/en-us/entra/fundamentals/security-defaults (read 2026-11-13)
- SMTP AUTH: "If security defaults is enabled in your organization, SMTP AUTH is already disabled in Exchange Online." Org switch `Set-TransportConfig -SmtpClientAuthenticationDisabled`; per mailbox `Set-CASMailbox -SmtpClientAuthenticationDisabled`, and the mailbox setting wins. "SMTP AUTH supports modern authentication (Modern Auth) through OAuth." — https://learn.microsoft.com/en-us/Exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission (read 2026-11-13)
- SMTP AUTH Basic retirement, updated timeline (2026-01-27): no change until December 2026; at the end of December 2026 Basic is "disabled by default for existing tenants", and admins can turn it on again; new tenants after December 2026 do not have it; the final removal date will be announced in the second half of 2027. — https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835
- OAuth for IMAP, POP and SMTP: register the app in Entra, then get a token and authenticate. The IMAP and SMTP permissions belong to the "Office 365 Exchange Online" resource, not to Microsoft Graph. — https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth ; https://learn.microsoft.com/en-us/answers/questions/5825132 (2026-03-17)
- Graph `sendMail` takes JSON or MIME: "Provide the applicable Internet message headers and the MIME content, all encoded in base64 format in the request body." "This method saves the message in the Sent Items folder." With MIME, `saveToSentItems=false` is not possible (Q&A, 2024-11-25). — https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0 ; https://learn.microsoft.com/en-us/answers/questions/2122804
- Graph webhooks: "you need to define a publicly accessible HTTPS-secured endpoint". — https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks
- Consent: since 2020, "End users will no longer be able to consent to new multi-tenant apps registered after November 8th, 2020 coming from unverified publishers" (except basic sign-in and profile permissions). — https://techcommunity.microsoft.com/blog/microsoft-entra-blog/publisher-verification-and-app-consent-policies-are-now-generally-available/1257374 (2020-10-07). Publisher verification needs a Microsoft AI Cloud Partner Program account. — https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
- "Since late 2025, Microsoft's default consent policy for work and school tenants stops employees from approving mail permissions such as `Mail.Read` and `Mail.ReadWrite`" — https://mcpemails.com/docs/microsoft-365-admin-consent (vendor page, marketing). A Microsoft Q&A answer (2026-01-12) says the same: admin consent depends on the customer's tenant policy, not on publisher verification. — https://learn.microsoft.com/en-my/answers/questions/5705172
- Test tenant: the Microsoft 365 Developer Program E5 sandbox is only for qualifying members (Visual Studio Professional or Enterprise subscribers, and others); it lasts up to 90 days. — https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq . Microsoft 365 Business Basic: $7.00 per user per month (paid yearly), one-month free trial, credit card required. — https://www.microsoft.com/en-us/microsoft-365/business/microsoft-365-business-basic (read 2026-11-13)

## Gmail

- Personal Gmail: "Starting January 2025" the Enable IMAP switch is gone; IMAP is always on. Google accepts "Sign in with Google" or an app password. — https://support.google.com/mail/answer/7126229 ; https://univik.com/email-settings/gmail.html (2026-01-15)
- Workspace: "Starting May 1, 2025, Google Workspace accounts no longer support less secure apps … that ask you to sign in … with your username and password. You must use OAuth." A Workspace admin controls IMAP in the Admin console. — https://knowledge.workspace.google.com/admin/sync/about-imap-and-pop-clients
- App passwords need 2-Step Verification. "Enforcing security keys disables app passwords." "App passwords are discouraged." — https://knowledge.workspace.google.com/admin/security/how-2-step-verification-works-with-legacy-apps ; https://support.google.com/mail/answer/185833
- The repo already has a `gmail` preset with `secretKind: "app_password"` (`packages/core/src/mail/providers.ts`). No note shows a run on a real Gmail mailbox.

## Web Push and PWA

- iOS and iPadOS 16.4 or later: Web Push only for a Home Screen web app; a Safari tab cannot ask for permission. Install is manual (Share, Add to Home Screen); no install prompt API. — https://openpwa.net/reference/notifications/ios-safari-push/ (2026-06-26) ; https://progressivewebapps.com/platforms/ios-safari/
- Declarative Web Push (WebKit, 2025-03-27): push without a service worker on Apple platforms. — https://webkit.org/blog/16535/meet-declarative-web-push/
- `web-push` npm 4.0.0, updated 2026-11-06; it uses `node:crypto`. A Bun issue (2023, "AES-GCM decryption failed") is still open. A WebCrypto library (`@portable/web-push`) says that it runs on Bun. — https://www.npmjs.com/package/web-push ; https://github.com/oven-sh/bun/issues/6455 ; https://portablejs.com/packages/web-push/ . The E9b stage 1 sends a real push to the owner's Android phone before any other work.

## Repo facts (2026-11-13)

- `imapflow` 1.7.8: `auth.accessToken` → `AUTHENTICATE` with the token (`node_modules/imapflow/lib/imap-flow.js:1957`).
- `mail/open.ts` `openMailboxProvider` is the one place that decrypts the secret and opens the provider and the sender. OAuth branches here.
- `mailboxes.protocol` allows only `imap`; `mailbox_credentials.secret_kind` allows `password`, `app_password`.
- `outbox` rows hold the rendered `text` (≤ 4096) and Telegram buttons, and `external_message_id bigint`. They are Telegram-shaped.
- The owner's test phone is a OnePlus 12 (Android) (`notes/2026-11-12-web-panel-deploy.md`).
