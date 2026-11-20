# F154 stage 09 — public content check, next path, CSP parse

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–08, 10–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Through | Count |
| --- | --- | --- | --- |
| `web/public-content.ts` | `ipv4Allowed` (private) | `publicContentProblems` rule R3 | 25 (top 10) |
| `web/public-content.ts` | `r4ExternalAsset` (private) | rule R4 | 17 |
| `web/public-content.ts` | `parseAllowList` | itself | 16 |
| `web/next-path.ts` | `safeNextPath` | itself | 16 |
| `web/csp.ts` | `parseDirectives` (private) | the exported CSP reader | 5 |

Mutate globs: `src/web/public-content.ts`, `src/web/next-path.ts`, `src/web/csp.ts`.

## Cases (fixed values)

R3 through `publicContentProblems(\`ip ${address} x\`, [])`, `test.each` with the exact problem list. Planner probe at `a5399ff1`, all held:
1. Allowed → `[]`: `127.0.0.1`, `10.1.2.3`, `172.16.0.1`, `172.31.255.1`, `192.168.1.1`, `0.0.0.0`, `192.0.2.1`, `198.51.100.7`, `203.0.113.9`.
2. Flagged → `[{ rule: "R3", match: <address> }]`: `172.15.0.1`, `172.32.0.1`, `192.169.1.1`, `0.0.0.1`, `192.0.3.1`, `198.51.101.7`, `203.0.114.9`, `8.8.8.8`.
3. Not an address → `[]`: `256.1.1.1`.

R4 through `publicContentProblems(html, [])`, exact R4 matches (with `DOCS_ORIGIN` from `site.ts`):
4. `<img src="https://cdn.x.io/a.png">`, `<img src='//cdn.x.io/a.png'>`, `<img src=https://cdn.x.io/a.png>` → one R4 match each, the URL.
5. `<img srcset="/a.png 1x, https://cdn.x.io/b.png 2x">` → only `https://cdn.x.io/b.png`.
6. `<link rel="stylesheet" href="https://cdn.x.io/s.css">`, `rel="preload"`, `rel="modulepreload"`, `rel="icon shortcut"` → the href; `rel="canonical"` → none.
7. `style="background:url('https://cdn.x.io/i.png')"`, `url("…")`, `url(…)` → the URL.
8. Same-origin: `src="${DOCS_ORIGIN}/a.png"` and `src="/a.png"` → none; `src="${DOCS_ORIGIN}evil.io/a.png"` → flagged (not a path under the origin).

`parseAllowList`:
9. `"# c\n\n1.2.3.4 | demo IP\n"` → `["1.2.3.4"]`.
10. A line with no ` | `, a line with an empty entry, and a line with an empty reason → the error behaviour at `HEAD` (exact thrown message with the line number), one row each.
11. Spaces: `"  1.2.3.4  |  demo  "` → `["1.2.3.4"]`.

`safeNextPath`, `test.each` input → output (planner probe, all held):
12. `null` → `/`; `""` → `/`; `"a"` → `/`; `"//evil"` → `/`; `"/\\evil"` → `/`; `"/x\u0007"` → `/`; `"/x\u007f"` → `/`; `"/login"` → `/`; `"/loginx"` → `/` (prefix rule, as the code is); `"/setup/x"` → `/`; `"/a?b#c"` → `/a?b#c`; `"/%2F%2Fevil"` → `/%2F%2Fevil`.
13. Edge: `"/x\u001f"` → `/` and `"/x "` → the code's output (kills the `<= 0x1f` boundary mutant); `"/x~"` → `/x~`.

`parseDirectives`:
14. One case per surviving mutant: spaces and empty parts between `;` are dropped; a directive name is lower-cased or not, as the code is at `HEAD`; the exact directive map.

## Done when

- `results/stage-09.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The docs integration in `apps/docs`. Rule changes.
