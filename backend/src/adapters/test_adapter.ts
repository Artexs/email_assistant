import path from "path";

import dotenv from "dotenv";

import { log } from "../utils/log";

import { Providers, EmailProviderType } from "./get_provider";

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function testEmailProvider() {
  log.info("Testing Email Provider...");

  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;
  const type: EmailProviderType = "INTERIA";

  if (!user || !password) {
    log.error("Missing IMAP_USER or IMAP_PASSWORD in .env");
    return;
  }

  log.info(`Initializing ${type} provider for ${user}...`);

  try {
    const emailProvider = Providers.getEmail(type, user, password);

    log.info("Attempting to list folders...");
    const folders = await emailProvider.listFolders();
    log.info("Folders found:", folders);

    if (folders.length > 0) {
      const inbox = "INBOX"; // Usually exists
      log.info(`Fetching latest 5 emails from ${inbox}...`);
      const emails = await emailProvider.fetchEmails(inbox, 15);

      log.info(`Fetched ${emails.length} emails.`);
      emails.forEach((email, index) => {
        log.info(`[${index + 1}] From: ${email.from}, Subject: ${email.subject}, Date: ${email.date}`);
      });
    }
  } catch (error) {
    log.error("Test Failed:", error);
    if (error instanceof Error) {
      if (error.message.includes("Please enable IMAP access")) {
        log.error("Hint: Enable IMAP in your email provider settings.");
      }
    }
  }
}

async function main() {
  await testEmailProvider();
}

main();
