> **Status 2026-11-10 — planned.** Idea from `test-mail-traffic` (user default 2026-11-07, P6); not started.

# Testmail: an AgentMail persona as the S4 test delegate

Scope: test tooling and the S4 delegation tests. Needs: `tasks/done/test-mail-traffic.md`.

## Goal

An AgentMail inbox acts as the S4 test delegate: it receives a delegation and replies in the thread, so the S4 live test needs no manual step.

## Why

S4 stage 22 needs "a second address the user owns" as the delegate (notes `notes/2026-11-07-agentmail-test-mail.md` §2, §5). The Free plan has 3 inboxes; 1 is used by testmail, 2 are the user's.

## Done when

- A delegate row points to an AgentMail address; a script reads the delegation mail and sends a reply in the thread; the S4 flow records the reply.
