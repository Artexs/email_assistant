# Capability map

> Agent-facing reference of what the system does now: one page per capability, with rules, entry points, data, limits and decisions. It is not on the public docs site (PD-100). User docs come with E10a.

## Rules

- A landed feature updates its capability page in the same change (PD-009). Once the docs site of E10a exists, a landed user-visible feature also updates its user doc page (en) in the same change (PD-100).
- A page states the code at the commit on its "Checked against" line. Plans and gaps go only to "Limits", with the ticket folder or F-number.
- Behaviour detail lives here. `docs/architecture.md` keeps goals, context, layout, module rules, ports, invariants, data model, security and deployment, and links here.
- A new capability adds a page and an index row in the same change.
- `apps/server/src/capability-map.test.ts` checks the pages: the index, the headings, the "Checked against" line, every repo path, every `bun run` script and every ADR number.

## Page template

```markdown
# <Title>

> Checked against the code at `<sha>`, YYYY-MM-DD.

## What it does now

<3–8 sentences, user and operator view. Only behaviour that the code at the checked commit has.>

## Rules

<Numbered behaviour rules (condition → result). Text moved from `docs/architecture.md` keeps its wording.>

## Entry points

<One table `| Kind | Name | Where |`. Kinds: job, CLI, route, Telegram, function, page. "Where" is a repo-root path in backticks, without a line number.>

## Data

<Tables and columns the capability writes; its status flows.>

## Limits

<What it does not do now, known gaps, and the ticket or epic that changes it (F-number or bare folder name, never a lane path).>

## Decisions

<ADR links (`ADR NNNN`) and PD rows.>

## Tests

<The main test files (repo-root paths).>
```

## Pages

| Page | Capability | Main modules |
| ---- | ---------- | ------------ |

Planned pages (F095 stages 03–07): sync, triage, actions and Undo, drafts and send, delegation, digest and notices, web panel, tenancy and plans, retention, backups.
