> **Status 2026-11-07 — planned.** Found in the S4 stage 19 dev run (D25). Not started.

# Keep the sender address in the approval quote header

Scope: approval message of a send (`chatQuoteText`). Needs: S4.

## Problem

The quote header of the approval message shows `Od: [link]@[link]`. `chatQuoteText` replaces domain tokens with `[link]` inside the sender address too. The top `From:` line has the label, so the address is lost in the quote.

## Idea

Keep the bare address in the quote header lines (`Od:`, `Do:`). Replace links only in the body text.

## Done when

- The quote header lines show the full address, for example `Od: anna@example.com`.
- Links in the quote body still read `[link]`.
- Tests: a header with an address, a body with a link.
