export interface Email {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
}

export interface IEmailProvider {
  fetchEmails(folder: string, limit?: number): Promise<Email[]>;
  listFolders(): Promise<string[]>;
}
