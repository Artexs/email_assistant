import {
  profileBodySchema,
  profilePreviewSchema,
  profileViewSchema,
  replySamplesConflictSchema,
  replySamplesQueuedSchema,
  replySamplesViewSchema,
  styleSuggestionAnswerSchema,
  styleSuggestionBodySchema,
  styleSuggestionConflictSchema,
  z,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the mailbox profile routes of the reply drafts (ADR 0023). Any member reads; the write
// and the preview are owner only. An unknown mailbox, or one of another organization, answers 404 `not_found`.
const tags = ["replies"];
const params = z.object({ id: z.uuid() });
const ownerOnly = { status: 403, codes: ["owner_only"] } as const;
const notFound = { status: 404, codes: ["not_found"] } as const;

export const replyDocs = {
  getProfile: apiDoc({
    operationId: "getMailboxProfile",
    summary:
      "The display name, the signature and the writing style of a mailbox (null: not set), and the texts that stand in for a null: `fallbackName` and `fallbackSignature`.",
    tags,
    params,
    ok: { status: 200, schema: profileViewSchema },
    errors: [notFound],
  }),
  putProfile: apiDoc({
    operationId: "putMailboxProfile",
    summary:
      'Set the display name (one line, 1 to 100 characters, none of `< > " @`), the signature (up to 1,000 characters) and the writing style (up to 1,000 characters) of a mailbox (owner only). A key that is left out stays; an empty string clears the field. A text that fails answers 400 `validation`. The answer is the same view as the read.',
    tags,
    params,
    body: profileBodySchema,
    ok: { status: 200, schema: profileViewSchema },
    errors: [ownerOnly, notFound],
  }),
  previewProfile: apiDoc({
    operationId: "previewMailboxProfile",
    summary:
      'One draft on a fixed sample mail, with the unsaved values of the card (owner only). It counts in the daily LLM cap like a tap. At most 10 a day for each mailbox: then 429 `preview_limit`; a second one at the same time answers 429 `preview_busy`. A draft that fails a check, or a failed call, answers 200 `{ kind: "failed", reason }`. 404 while the flag `reply_drafts` is off.',
    tags,
    params,
    body: profileBodySchema,
    ok: { status: 200, schema: profilePreviewSchema },
    errors: [ownerOnly, notFound, { status: 429, codes: ["preview_limit", "preview_busy"] }],
  }),
  suggestStyle: apiDoc({
    operationId: "suggestMailboxStyle",
    summary:
      'One suggested writing style from the sent mail of the last 14 days (owner only; the body is `{}`, a key answers 400 `validation`). The text is for the owner to edit and save; nothing is stored but one audit row. 200 gives `{ text, count }` (`count`: the sent mails that the model read); a failed call or a text that fails a check gives 200 `{ kind: "failed", reason }` with `llm_off`, `llm_cap`, `checks`, `output` or `provider`. 409 `sent_off` while sent tracking is off for the mailbox or the organization; 409 `too_few` with the `count` found when fewer than 5 sent mails qualify; 409 `blocked` with `reason` `oauth_mailbox` for an OAuth mailbox. At most 3 runs with a model call a day for each mailbox: then 429 `suggest_limit`; a second run at the same time gives 429 `suggest_busy`. It counts in the daily LLM cap like a tap. 404 while the flag `reply_drafts` or the flag `style_from_sent` is off.',
    tags,
    params,
    body: styleSuggestionBodySchema,
    ok: { status: 200, schema: styleSuggestionAnswerSchema },
    errors: [
      ownerOnly,
      notFound,
      { status: 409, codes: ["sent_off", "too_few", "blocked"], schema: styleSuggestionConflictSchema },
      { status: 429, codes: ["suggest_limit", "suggest_busy"] },
    ],
  }),
  postSamples: apiDoc({
    operationId: "requestReplySamples",
    summary:
      "Ask for up to three sample drafts on the newest mails of the last 7 days that need a reply (owner only; any mailbox mode). The answer lists the request ids and their number: fewer than three when fewer mails qualify (0 uses up nothing). A sample is read in the panel; it is never saved in Drafts and never sent. It counts in the daily LLM cap like a tap. One run for each mailbox and quota day: then 409 `sample_limit`. A mailbox of an OAuth provider answers 409 `blocked` with `reason` `oauth_mailbox`. 409 `llm_off` while no model client runs. 404 while the flag `reply_drafts` is off.",
    tags,
    params,
    ok: { status: 202, schema: replySamplesQueuedSchema },
    errors: [
      ownerOnly,
      notFound,
      { status: 409, codes: ["blocked", "sample_limit", "llm_off"], schema: replySamplesConflictSchema },
    ],
  }),
  getSamples: apiDoc({
    operationId: "getReplySamples",
    summary:
      "The sample drafts of today's run for a mailbox (owner only), oldest first: the status of each request, the subject of its mail and, for a `done` request, the sample text. The panel polls until no item is `pending` or `drafting`. Retention clears the texts. 404 while the flag `reply_drafts` is off.",
    tags,
    params,
    ok: { status: 200, schema: replySamplesViewSchema },
    errors: [ownerOnly, notFound],
  }),
};
