# F103 stage 17 review (Opus 5.5, PASS b6ef0ebb)

Model: Opus 5.5, because the stage edits the Compose file and log drivers (deploy path).

No BLOCKING. TG1 and TG2 fixed in a Sonnet continue (profile `cli` not asserted; two `run` forms missed by the document check). TG3 (testmail/remote.ts still runs through `server`) carried to stage 18.

Notes: `run` does not publish inherited ports (`up cli` would collide on 8080); the sim split is beyond the stage text but needed; the new test fails loud without docker or jq; prettier fails on compose.sim.yaml at the base too. Deploy runbook: first VPS deploy recreates db (volume safe), possible one server restart (no pool error handler); backup first. Unverified: real `compose run` behaviour (no daemon by rule); CI Compose version (master CI green).
