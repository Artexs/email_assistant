# F125 · Questions and defaults

- **Q1 [important: rule-exception]** The owner default was "a mutation tool as a dev dependency in `packages/core`". The plan does not add one: `scripts/test-audit/mutation.sh` installs Stryker in a temp folder at run time (D4). Reason: no `bun.lock` change next to parallel jobs, no risk for the image build (`deploy/Dockerfile` copies named workspace files). Undo: add `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` to the root dev dependencies and point `mutation.sh` at the repo. Default: temp folder.
- **Q2 [important: scope]** The approval unit at G1 is a group (5 to about 60 rows with one action and one rule), not a single row, with a reject list for single rows (P2). Reason: about 4,000 cases; the owner's attention is scarce. Default: groups.
- **Q3 [minor]** Reader stages read at most 250 items per area; the rest is `not read` and stays (N4, Reader method step 2). Default: 250.
- **Q4 [minor]** No mutation testing for `apps/server` and `apps/web` (D5). A later audit can add it if the core run proves useful. Default: core only.
