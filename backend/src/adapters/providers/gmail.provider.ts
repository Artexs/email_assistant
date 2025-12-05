import { google, gmail_v1 } from "googleapis";

import { log } from "../../utils/log";
import { IEmailProvider, Email } from "../interfaces/email.interface";

export class GmailAdapter implements IEmailProvider {
  private gmail: gmail_v1.Gmail;

  constructor(auth: gmail_v1.Params$Resource$Users$Messages$List["auth"]) {
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async listFolders(): Promise<string[]> {
    try {
      const response = await this.gmail.users.labels.list({
        userId: "me",
      });
      return response.data.labels?.map((label) => label.name || "") || [];
    } catch (error) {
      log.error("Error listing folders:", error);
      throw error;
    }
  }

  async fetchEmails(folder = "INBOX", limit = 10): Promise<Email[]> {
    try {
      // 1. List messages in the specified folder (label)
      const listResponse = await this.gmail.users.messages.list({
        userId: "me",
        q: `label:${folder}`,
        maxResults: limit,
      });

      const messages = listResponse.data.messages || [];
      const emails: Email[] = [];

      // 2. Fetch details for each message
      for (const message of messages) {
        if (!message.id) continue;

        const detailResponse = await this.gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

        const msgData = detailResponse.data;
        const headers = msgData.payload?.headers || [];

        const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
        const from = headers.find((h) => h.name === "From")?.value || "(Unknown Sender)";
        const to = headers.find((h) => h.name === "To")?.value || "(Unknown Recipient)";
        const dateStr = headers.find((h) => h.name === "Date")?.value || "";
        const date = dateStr ? new Date(dateStr) : new Date();

        // Simple body extraction (snippet is often enough for lists, but let's try to get body)
        let body = msgData.snippet || "";
        if (msgData.payload?.body?.data) {
          body = Buffer.from(msgData.payload.body.data, "base64").toString("utf-8");
        } else if (msgData.payload?.parts) {
          // Very basic part handling - prefer text/plain
          const part = msgData.payload.parts.find((p) => p.mimeType === "text/plain");
          if (part && part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString("utf-8");
          }
        }

        emails.push({
          id: msgData.id || "",
          threadId: msgData.threadId || "",
          labelIds: msgData.labelIds || [],
          snippet: msgData.snippet || "",
          from,
          to,
          subject,
          body,
          date,
        });
      }

      return emails;
    } catch (error) {
      log.error(`Error fetching emails from ${folder}:`, error);
      throw error;
    }
  }
}
