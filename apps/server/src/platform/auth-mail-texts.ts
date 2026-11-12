import type { UserLocale } from "@ea/core";

export type AuthMailKind = "invite" | "reset" | "lockout";

// Plain text only (no HTML, so no tracking pixel). `{url}` is replaced by the link; nothing else changes.
const texts: Record<AuthMailKind, Record<UserLocale, { subject: string; text: string }>> = {
  invite: {
    en: {
      subject: "Your Email Assistant account",
      text: "Hello,\n\nYou have an account in Email Assistant. Set your password with this link:\n\n{url}\n\nThe link works once and expires in 24 hours. If you did not expect this mail, ignore it.\n\nEmail Assistant\n",
    },
    pl: {
      subject: "Twoje konto w Email Assistant",
      text: "Dzień dobry,\n\nmasz konto w Email Assistant. Ustaw hasło, korzystając z tego linku:\n\n{url}\n\nLink działa jeden raz i wygasa po 24 godzinach. Jeśli nie spodziewasz się tej wiadomości, zignoruj ją.\n\nEmail Assistant\n",
    },
  },
  reset: {
    en: {
      subject: "Reset your Email Assistant password",
      text: "Hello,\n\nSomeone asked to reset the password of your Email Assistant account. Set a new password with this link:\n\n{url}\n\nThe link works once and expires in 1 hour. If you did not ask for it, ignore this mail. Your password stays the same.\n\nEmail Assistant\n",
    },
    pl: {
      subject: "Zmiana hasła w Email Assistant",
      text: "Dzień dobry,\n\nktoś poprosił o zmianę hasła do Twojego konta w Email Assistant. Ustaw nowe hasło, korzystając z tego linku:\n\n{url}\n\nLink działa jeden raz i wygasa po 1 godzinie. Jeśli to nie Ty, zignoruj tę wiadomość. Twoje hasło się nie zmieni.\n\nEmail Assistant\n",
    },
  },
  lockout: {
    en: {
      subject: "Your Email Assistant account is locked for 15 minutes",
      text: "Hello,\n\nThere were 10 failed sign-ins to your Email Assistant account in 15 minutes. We locked the sign-in for 15 minutes.\n\nIf this was not you, set a new password: {url}\n\nEmail Assistant\n",
    },
    pl: {
      subject: "Konto w Email Assistant zablokowane na 15 minut",
      text: "Dzień dobry,\n\nw ciągu 15 minut było 10 nieudanych prób logowania do Twojego konta w Email Assistant. Zablokowaliśmy logowanie na 15 minut.\n\nJeśli to nie Ty, ustaw nowe hasło: {url}\n\nEmail Assistant\n",
    },
  },
};

export function authMailText(kind: AuthMailKind, locale: UserLocale, url: string): { subject: string; text: string } {
  const { subject, text } = texts[kind][locale];
  // A replacer function: a `$` in the link is not a replacement pattern.
  return { subject, text: text.replace("{url}", () => url) };
}
