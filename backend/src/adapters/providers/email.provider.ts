import { ImapFlow } from "imapflow";

import { IEmailProvider, Email } from "../interfaces/email.interface";

export interface ImapConfig {
  user: string;
  password?: string;
  host: string;
  port: number;
  secure: boolean;
  tls?: { rejectUnauthorized: boolean };
}

export class ImapEmailProvider implements IEmailProvider {
  private client: ImapFlow;
  private logoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly LOGOUT_DELAY_MS = 60 * 1000; // 1 minute

  constructor(config: ImapConfig) {
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password || "",
      },
      tls: config.tls,
      logger: false,
    });
  }

  private async ensureConnection() {
    this.resetLogoutTimer();
    if (this.client.usable) return;
    await this.client.connect();
  }

  private resetLogoutTimer() {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    this.logoutTimer = setTimeout(() => {
      if (this.client.usable) {
        this.client.logout().catch(() => {
          // Ignore logout errors
        });
      }
    }, this.LOGOUT_DELAY_MS);
  }

  async listFolders(): Promise<string[]> {
    await this.ensureConnection();
    const folders = await this.client.list();
    return folders.map((f) => f.path);
  }

  async fetchEmails(folder = "INBOX", limit = 10): Promise<Email[]> {
    await this.ensureConnection();

    const lock = await this.client.getMailboxLock(folder);
    try {
      const total = this.client.mailbox?.exists || 0;
      if (total === 0) return [];

      const start = Math.max(1, total - limit + 1);
      const emails: Email[] = [];

      for await (const message of this.client.fetch(`${start}:*`, { envelope: true })) {
        const { envelope, uid } = message;
        emails.push({
          id: uid.toString(),
          threadId: uid.toString(),
          labelIds: [folder],
          snippet: "",
          from: envelope.from?.[0]?.address || "(Unknown)",
          to: envelope.to?.[0]?.address || "(Unknown)",
          subject: envelope.subject || "(No Subject)",
          body: "(Body parsing requires mailparser)",
          date: envelope.date || new Date(),
        });
      }

      return emails.reverse();
    } finally {
      lock.release();
    }
  }
}
