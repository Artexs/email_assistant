# F136 stage 05 — parallel proof (partial)

HEAD for both attempts: `73096619a38bb218bf3026305f4dfce5c96ae5ac` (script `scripts/e2e-parallel-check.sh`). The job hit its time limit before the full acceptance run finished. Saved logs are under `/tmp/f136-s05/`.

## Result

- **Proven.** Three job worktrees ran `bun run test:e2e` at the same time with no lock, and all three passed (448 passed, 6 skipped each) in three separate rounds: attempt 1 rounds 1 and 2, attempt 2 round 1. No port, DB, GreenMail or file clash showed in the logs.
- **Not proven.** Three rounds in a row: attempt 1 lost round 3 when the `/tmp` RAM disk filled up at 05:45; attempt 2 was stopped after round 1. The docs suite with two parallel runs did not run at all. `PARALLEL_OK` was never printed. Run again: `bash scripts/e2e-parallel-check.sh --e2e-runs 3 --docs-runs 2 --rounds 3 --out /tmp/f136-s05/rounds`.

## Summaries (per-run lines)

Attempt 1, `/tmp/f136-s05/rounds-attempt1.log` (load average 8.6 before round 1):

```
e2e round 1 run 1 exit 0 start 1795146906.165780513 end 1795148009.860059425 peak_mb 2046
e2e round 1 run 2 exit 0 start 1795146906.166539567 end 1795147976.569332043 peak_mb 2073
e2e round 1 run 3 exit 0 start 1795146906.166310729 end 1795148010.661782606 peak_mb 2123
e2e round 2 run 1 exit 0 start 1795148010.670946944 end 1795149090.840280083 peak_mb 2097
e2e round 2 run 2 exit 0 start 1795148010.670917324 end 1795149080.480081680 peak_mb 1984
e2e round 2 run 3 exit 0 start 1795148010.671135242 end 1795149079.868067160 peak_mb 2099
e2e round 3 runs 1-3: exit 99 (result file empty; "Disk quota exceeded" on /tmp, a 16 GB RAM disk shared with other jobs)
docs rounds 1-3: exit 99, same cause
```

Attempt 2, `/tmp/f136-s05/rounds.log` (load average about 40 to 48; stopped by hand after round 1; its trap removed the worktrees and dropped the DBs):

```
e2e round 1 run 1 exit 0 start 1795150669.308592086 end 1795152388.534908760 peak_mb 2042
e2e round 1 run 2 exit 0 start 1795150669.307478245 end 1795152388.399412868 peak_mb 2061
e2e round 1 run 3 exit 0 start 1795150669.310028144 end 1795152364.421546885 peak_mb 2047
```

Round time: about 18 min at load 10 to 20, about 28.6 min at load 40 to 48. In attempt 1 round 1 all three runs started within 1 ms.

## Memory

- Panel suite (`test:e2e`: Playwright, Chromium and the server tree of one run), nine completed runs: peak 2123 MB max, 2061 MB median (about 2.1 GB per run). Three parallel runs peaked at about 6.2 GB together.
- Docs suite: no parallel run completed. One single run (`/tmp/f136-s05/small.log`) peaked at 1894 MB. Two parallel runs: unverified.
- Free memory before round 1 of attempt 1 (`/tmp/f136-s05/free-before.txt`): total 32003 MB, used 18959, free 4767, available 13043, swap used 8246 of 64012; load average 8.6. Before attempt 2 round 1 (`/tmp/f136-s05/rounds.log`): available 9328 MB, load average 39.9. Other jobs ran on the machine the whole time.

## Findings

- A first start failed at worktree 3 with a disk quota error in `bun install`, because the script put worktrees under `/tmp` (RAM disk). The script now makes them next to the calling worktree (`73096619`).
- The script writes logs and result files to `--out`. When `--out` is on a full `/tmp`, runs end with exit 99. A rerun needs free space on `/tmp`.
