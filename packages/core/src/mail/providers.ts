export const presetKeys = ["interia", "gmail", "onet", "wp", "o2", "icloud"] as const;
export type PresetKey = (typeof presetKeys)[number];

/** `tls` = implicit TLS (port 465). `starttls` = a plain start, then STARTTLS is required (port 587). */
export const smtpSecurities = ["tls", "starttls"] as const;
export type SmtpSecurity = (typeof smtpSecurities)[number];

export interface MailPreset {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  secretKind: "password" | "app_password";
  domains: readonly string[];
}

export const MAIL_PRESETS: Readonly<Record<PresetKey, MailPreset>> = {
  interia: {
    imapHost: "poczta.interia.pl",
    imapPort: 993,
    smtpHost: "poczta.interia.pl",
    smtpPort: 465,
    smtpSecurity: "tls",
    secretKind: "password",
    domains: ["interia.pl"],
  },
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    secretKind: "app_password",
    domains: ["gmail.com"],
  },
  onet: {
    imapHost: "imap.poczta.onet.pl",
    imapPort: 993,
    smtpHost: "smtp.poczta.onet.pl",
    smtpPort: 465,
    smtpSecurity: "tls",
    secretKind: "password",
    domains: ["onet.pl"],
  },
  wp: {
    imapHost: "imap.wp.pl",
    imapPort: 993,
    smtpHost: "smtp.wp.pl",
    smtpPort: 465,
    smtpSecurity: "tls",
    secretKind: "password",
    domains: ["wp.pl"],
  },
  o2: {
    imapHost: "poczta.o2.pl",
    imapPort: 993,
    smtpHost: "poczta.o2.pl",
    smtpPort: 465,
    smtpSecurity: "tls",
    secretKind: "password",
    domains: ["o2.pl"],
  },
  icloud: {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    secretKind: "app_password",
    domains: ["icloud.com", "me.com", "mac.com"],
  },
};

export function presetForAddress(address: string): PresetKey | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (domain === "") return null;
  return presetKeys.find((key) => MAIL_PRESETS[key].domains.includes(domain)) ?? null;
}

export interface ServerFields {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
}

/** Without a preset, `smtpSecurity` defaults to `tls`. */
export function serversFor(input: { preset?: PresetKey } & Partial<ServerFields>): ServerFields {
  if (input.preset !== undefined) {
    const { imapHost, imapPort, smtpHost, smtpPort, smtpSecurity } = MAIL_PRESETS[input.preset];
    return { imapHost, imapPort, smtpHost, smtpPort, smtpSecurity };
  }
  const { imapHost, imapPort, smtpHost, smtpPort, smtpSecurity = "tls" } = input;
  if (imapHost === undefined || imapPort === undefined || smtpHost === undefined || smtpPort === undefined) {
    throw new Error("server fields missing");
  }
  return { imapHost, imapPort, smtpHost, smtpPort, smtpSecurity };
}
