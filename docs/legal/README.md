# Legal papers

Every paper is a draft, not legal advice. It describes the setup that the code and the docs show at the build commit. A fact that no file states is a visible placeholder (`<to confirm: …>`). No person, company or address is named, because the repository is public. The papers are English only. The in-app pages are Polish and English.

## Internal papers (`docs/legal/`)

- [records-of-processing.md](records-of-processing.md) — records of processing, GDPR Art. 30: record A (provider as controller of member account data) and record B (provider as processor of the mail).
- [dpia.md](dpia.md) — draft data protection impact assessment, GDPR Art. 35, for the processing of executives' mail with an LLM.
- [breach-procedure.md](breach-procedure.md) — personal data breach procedure, GDPR Art. 33 and 34: detect, contain, assess, notify, record, after. The breach register lives outside this repository.
- [claims.md](claims.md) — the claims list: each factual claim of the six in-app texts, the two registries and the three papers above, with its source (a repo path, an ADR or a public URL with the date read) and the condition that changes it. The test `apps/server/src/legal-papers.test.ts` checks its shape. The counts per paper are at the top of the file.

## In-app pages (static, no sign-in)

Source: `apps/web/src/legal/<lang>/<doc>.md`. The page frame: `apps/web/src/pages/legal/[lang]/[doc].astro`.

| Route               | Text                               |
| ------------------- | ---------------------------------- |
| `/legal/en/privacy` | Privacy policy, English            |
| `/legal/en/terms`   | Terms of service, English          |
| `/legal/en/dpa`     | Data processing agreement, English |
| `/legal/pl/privacy` | Privacy policy, Polish             |
| `/legal/pl/terms`   | Terms of service, Polish           |
| `/legal/pl/dpa`     | Data processing agreement, Polish  |

## Shared lists

- Sub-processors: `packages/core/src/legal/subprocessors.ts`.
- Data categories: `packages/core/src/legal/data-categories.ts`.

The records of processing name every data category and every sub-processor with personal data. The test `apps/server/src/legal-papers.test.ts` fails when one is missing.
