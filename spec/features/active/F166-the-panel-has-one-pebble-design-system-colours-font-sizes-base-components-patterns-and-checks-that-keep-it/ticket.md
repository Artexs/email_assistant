---
opened: 2026-11-23
---

# F166 · The panel has one Pebble design system (colours, font, sizes, base components, patterns) and checks that keep it

## Outcome

The panel has one design system for the Pebble look: colour, radius, shadow and type tokens that pass WCAG AA in light and dark, a self-hosted rounded font, restyled base components, and a set of shared patterns. A contact sheet shows every page in every scheme, size and language, and tests stop a raw colour or an unused text from coming back. After this ticket every page already shows the new colours and controls; the page layouts follow in the next tickets.

## Scope

- The token file `apps/web/src/styles/global.css` and the font files.
- The 17 primitives in `apps/web/src/components/ui/`.
- New pattern components in `apps/web/src/components/patterns/`, the category look record, and a pattern page that is only in the dev and e2e build.
- The contact sheet run (`bun run ui:sheet`) and the a11y scan in the dark scheme.
- The design system ADR, the web rules in `docs/code-patterns.md`, the guard tests.

## Out of scope

- The shell, the navigation and any page layout (the next tickets).
- App icons, favicon and manifest colours (the shell ticket).
- A manual dark-mode switch; a visual-diff tool.

## Acceptance

- `bun run ui:sheet` writes one PNG per route, viewport, scheme, language and organization state, and one `index.html` that shows them.
- The a11y scan of every existing e2e spec passes in the light scheme on both projects and in the dark scheme on the desktop project.
- The pattern page shows every primitive variant and every pattern to a signed-in user of the dev build; the production build does not hold it.
- A component file with `bg-amber-50` or a hex colour fails `bun run test:unit`; a text key that no source file reads fails it too.
- The text of the panel renders in Nunito with Polish letters, with no request to another host.
- `docs/decisions/` holds the design system ADR with the final token values.

## Slices

Eleven stages in four waves: [`plan.md`](plan.md) § Stages and § How to run. No owner step is open.

## Sequenced

- Plan after: none.
- Build after: none. Gate: none.

## Notes

Programme page with the shared decisions: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Names that later tickets use: [`interfaces.md`](interfaces.md).
