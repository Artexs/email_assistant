import path from "path";

import dotenv from "dotenv";
import { google } from "googleapis";

import { log } from "../utils/log";

import { IntegrationFactory } from "./factory";

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function testGmailAdapter() {
  // NOTE: This test requires a valid credentials.json or OAuth2 setup.
  // For now, we will mock the auth object or check if env vars are present.
  // In a real scenario, we'd need a way to get a valid OAuth2Client.

  log.info("Initializing Gmail Adapter...");

  // Mock auth for structure verification if no real creds
  // In reality, user needs to provide:
  // const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  // auth.setCredentials({ refresh_token: REFRESH_TOKEN });

  // For this test, we'll check if we can instantiate it.
  // Without valid creds, API calls will fail, which is expected.

  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID || "mock_id",
    process.env.GMAIL_CLIENT_SECRET || "mock_secret"
  );

  if (process.env.GMAIL_REFRESH_TOKEN) {
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  }

  const emailProvider = IntegrationFactory.createEmailProvider("GMAIL", { auth });

  log.info("Listing folders...");
  try {
    const folders = await emailProvider.listFolders();
    log.info("Folders:", folders);
  } catch (error) {
    log.error("Error listing folders (expected if no valid creds):", (error as Error).message);
  }

  log.info("Fetching emails from INBOX...");
  try {
    const emails = await emailProvider.fetchEmails("INBOX", 5);
    log.info(`Fetched ${emails.length} emails.`);
    if (emails.length > 0) {
      log.info("First email subject:", emails[0].subject);
    }
  } catch (error) {
    log.error("Error fetching emails (expected if no valid creds):", (error as Error).message);
  }
}

async function testSupabaseAdapter() {
  log.info("\n=== Testing Supabase Adapter ===");

  // Check if Supabase credentials are available
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    log.info("Skipping Supabase tests - SUPABASE_URL and SUPABASE_KEY not set in .env");
    return;
  }

  const dbProvider = IntegrationFactory.createDatabaseProvider("SUPABASE", {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  });

  log.info("Supabase adapter initialized successfully");

  // Example: Count users
  try {
    log.info("Counting users...");
    const userCount = await dbProvider.count("users");
    log.info(`Total users: ${userCount}`);
  } catch (error) {
    log.error("Error counting users:", (error as Error).message);
  }

  // Example: Select users with filters
  try {
    log.info("Fetching users...");
    const users = await dbProvider.select("users", {
      limit: 5,
      orderBy: { column: "created_at", ascending: false },
    });
    log.info(`Fetched ${users.length} users`);
    if (users.length > 0) {
      log.info("First user:", users[0]);
    }
  } catch (error) {
    log.error("Error fetching users:", (error as Error).message);
  }

  // Example: Select with filters
  try {
    log.info("Fetching active mailboxes...");
    const mailboxes = await dbProvider.select("mailboxes", {
      filters: [{ column: "is_active", operator: "eq", value: true }],
      limit: 10,
    });
    log.info(`Found ${mailboxes.length} active mailboxes`);
  } catch (error) {
    log.error("Error fetching mailboxes:", (error as Error).message);
  }

  // Example: Select one
  try {
    log.info("Fetching one user...");
    const user = await dbProvider.selectOne("users", {
      limit: 1,
    });
    if (user) {
      log.info("Found user:", user);
    } else {
      log.info("No users found");
    }
  } catch (error) {
    log.error("Error fetching one user:", (error as Error).message);
  }
}

async function main() {
  await testGmailAdapter();
  await testSupabaseAdapter();
}

main();
