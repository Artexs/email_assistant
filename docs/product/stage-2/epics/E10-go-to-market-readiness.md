# E10 · Go-to-market readiness without sales

> Tier: Should. Status: needs a short discovery session (queue `05` §3); plan only after E2, E3 and E7 land. Size: about 12 stages, 2k lines, mostly text and pages.

## Outcome

A stranger can understand what the product is, what it does with their mail, what it would cost, and see it work, without any sale taking place. The user and operator docs exist.

## Users

A prospective buyer or auditor; a new user; the operator.

## In scope

- Positioning page from `03` §2 (one paragraph, the three jobs, what is different).
- Security-and-data page (04 §3): who holds a copy of the mail, is it used for training, where is it processed, which sub-processors (LLM provider, Telegram, Backblaze, Tailscale), retention, delete and export, the "never auto-send" rule.
- Pricing page with a placeholder price derived from M7 and the cost model (E3, E7).
- User docs: manual, FAQ, onboarding guide (Diátaxis: tutorial, how-to, reference, explanation); operator docs: runbooks, deploy, alerts (E8). Docs site built from the repo. The capability map (E1) is the reference part.
- Public changelog; "What is new" in the panel.
- A two-minute demo video from the demo organization (E2) and the "what I would have done" report (E4).
- Static status page (optional).

## Out of scope

Real pricing, payment, a company, marketing campaigns, SEO work.

## Dependencies

E2a (numbers for the pages), E2b (demo organization in the sim stack with its reset command, PD-027), E3 (numbers), E7 (papers, cost model). E8 for operator docs.

From E8 discovery (2026-11-13, PD-051–PD-055): the operator docs (runbooks per alert, release and rollback, restore drill with its measured time, VPS-lost runbook) come from E8. The security-and-data page states: logs hold ids, codes and counts only (a canary test proves it), stay on the server, 30 days; no hosted log or error service; Healthchecks.io receives timing pings only, no data. The public changelog builds on E8's `CHANGELOG.md` (SemVer `0.y.z`, `1.0.0` at the Stage 2 exit).

## Open product questions

1. Docs site tool (Astro Starlight fits the existing stack) and where it is served (tailnet only, or a public static site with no product behind it).
2. Language of the public pages: Polish and English, or English first.

## Risks

- Text drifts from the product: the PD-009 rule (a landed feature updates its capability page) keeps the reference part true; the marketing pages need a review per release.

## Exit

- The pages exist and the owner reads them as a stranger would; the demo video plays; the docs site builds in CI.
