import type { BatchCase } from "./batch";
import { caseLabel, TESTMAIL_LABEL } from "./send-log";

export interface AgentMailSendRequest {
  to: string[];
  subject: string;
  text: string;
  headers: Record<string, string>;
  labels: string[];
}

export function buildSendRequest(input: {
  batchId: string;
  testCase: BatchCase;
  to: string;
  parentMessageId: string | null;
}): AgentMailSendRequest {
  const { batchId, testCase, to, parentMessageId } = input;
  const headers: Record<string, string> = { "X-EA-Testmail": `${batchId}/${testCase.id}` };
  if (parentMessageId !== null) {
    headers["In-Reply-To"] = parentMessageId;
    headers["References"] = parentMessageId;
  }
  return {
    to: [to],
    subject: testCase.subject,
    text: testCase.body,
    headers,
    labels: [TESTMAIL_LABEL, caseLabel(batchId, testCase.id)],
  };
}
