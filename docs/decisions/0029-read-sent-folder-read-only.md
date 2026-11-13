# 0029 — The sync reads the Sent folder, read-only

- Status: proposed (E5 discovery, 2026-11-13; owner accepted the defaults, PD-115–PD-129; amended for E6 by PD-077 and PD-080). The ticket that lands E5a sets "accepted". Amends 0014 and the rule "never reads Sent" in `docs/architecture.md` §4.1 rule 1 and §5 (synced folders).
- Date: 2026-11-13

## Context

The system never reads the user's Sent folder (architecture §4.1 rule 1), so that mail the system does not own is never touched. It reads Sent only to find its own copy after a send (`mail/locate.ts`).

Four Stage 2 epics need to know what the user sent:
- E5 Open loops: the replies the user waits for, mail the user forwarded to a delegate by hand, promises the user made.
- E4-B history check (ADR 0028): "important to you = the user answered it". The IMAP flag `\Answered` is not proven on Interia; a reply in Sent is provider-independent.
- E3a M1 on real mail: `needs_reply` mail the user answered but the system did not mark.
- E6 Reply drafts: a draft is stale when the user already answered in their own mail app; style examples from recent sent mail.

Market products (Superhuman, Inbox Zero, Gmail nudges) all read sent mail for follow-ups (`docs/product/stage-2/epics/E05-discovery-notes.md` §3).

## Decision

1. **Read-only.** The sync adds one pass per run over the mailbox's `\Sent` folder with its own cursor (`UIDVALIDITY` + last UID, as in ADR 0014). It fetches with `BODY.PEEK`, sets no flag, moves nothing, deletes nothing, appends nothing. The committer's existing Sent copy after a system send is not part of this pass and does not change.
2. **Own table.** Sent mail is stored apart from `emails`: it never enters triage, the digest, moves, Undo or `auto`. Stored: `Message-ID`, `In-Reply-To`, `References`, thread key, `To`, `Cc` (never `Bcc`), subject, sent time, `X-EA-Action-Id`, auto-submitted and list markers, and the text under the same retention as `emails.body_text`.
3. **System sends are linked, not analysed.** A Sent message with an `X-EA-Action-Id` of this mailbox links to its action. Before a system send of any draft, the committer runs one Sent pass for that mailbox, so a reply the user already sent by hand is seen (`sent_by_user`, PD-076, PD-077).
4. **Answered marks.** A sent message that answers a stored incoming mail (header match) marks that mail "answered by the user" with the time. E3, E4, E5, E6 and E11 read this one mark; E11 computes reply delays from it (PD-109).
5. **Window.** At connect: headers of the last 30 days; text only for the last 14 days. Then incremental with each sync run.
6. **Consent and switch.** A per-mailbox switch "Track my sent mail": on for new mailboxes, with one plain line in the connect flow; off for existing mailboxes until the owner turns it on. The whole feature is behind the organization flag `sent_sync` (ADR 0027), default off until the pilot passes.
7. **Data rules.** Sent text reaches the LLM only for (a) the E5 analysis of each sent mail in the window and (b) once, on the user's tap, the E6b "Suggest my style from my sent mail" call (up to 100 own sent texts of the last 14 days, quotes cut; only the saved style text stays; PD-080). Both under ADR 0012 (no new provider, no new sub-processor). No sent mail is an example in a later prompt. Logs carry ids and counts only. Recipient columns join the DSR address map (PD-038) and the organization delete.
8. **Mail text stays untrusted.** Sent text holds quoted third-party text. An address from Sent headers can be a follow-up recipient only on the user's tap on the exact rendered mail (ADR 0003); LLM output never names a recipient.

## Consequences

- One more folder fetch per sync run; usually no new UID. The E8 load test covers it.
- Mail sent from an app that keeps no Sent copy (Interia SMTP saves none; some phone apps) is invisible. A setup check at connect and a "no sent mail seen in 7 days" notice cover it.
- New personal data of third parties (recipients of the user's mail): the records of processing and the DPIA (E7-T4) name it; retention (F027) and DSR erase cover it.
- `docs/architecture.md` §4.1 rule 1 and §5 change when E5a lands: "reads Sent read-only (ADR 0029), never changes it".
- E9's Graph and Gmail adapters must offer the same Sent pass behind the `MailProvider` port.
