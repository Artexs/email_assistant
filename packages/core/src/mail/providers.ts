export const presetKeys = ["interia", "gmail", "onet", "wp", "o2"] as const;
export type PresetKey = (typeof presetKeys)[number];

export interface MailPreset {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  secretKind: "password" | "app_password";
  domains: readonly string[];
}

export const MAIL_PRESETS: Readonly<Record<PresetKey, MailPreset>> = {
  interia: {
    imapHost: "poczta.interia.pl",
    imapPort: 993,
    smtpHost: "poczta.interia.pl",
    smtpPort: 465,
    secretKind: "password",
    domains: ["interia.pl"],
  },
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    secretKind: "app_password",
    domains: ["gmail.com"],
  },
  onet: {
    imapHost: "imap.poczta.onet.pl",
    imapPort: 993,
    smtpHost: "smtp.poczta.onet.pl",
    smtpPort: 465,
    secretKind: "password",
    domains: ["onet.pl"],
  },
  wp: {
    imapHost: "imap.wp.pl",
    imapPort: 993,
    smtpHost: "smtp.wp.pl",
    smtpPort: 465,
    secretKind: "password",
    domains: ["wp.pl"],
  },
  o2: {
    imapHost: "poczta.o2.pl",
    imapPort: 993,
    smtpHost: "poczta.o2.pl",
    smtpPort: 465,
    secretKind: "password",
    domains: ["o2.pl"],
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
}

export function serversFor(input: { preset?: PresetKey } & Partial<ServerFields>): ServerFields {
  if (input.preset !== undefined) {
    const { imapHost, imapPort, smtpHost, smtpPort } = MAIL_PRESETS[input.preset];
    return { imapHost, imapPort, smtpHost, smtpPort };
  }
  const { imapHost, imapPort, smtpHost, smtpPort } = input;
  if (imapHost === undefined || imapPort === undefined || smtpHost === undefined || smtpPort === undefined) {
    throw new Error("server fields missing");
  }
  return { imapHost, imapPort, smtpHost, smtpPort };
}
