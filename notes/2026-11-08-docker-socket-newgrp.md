# Docker socket from an agent process (2026-11-08)

On the Linux PC (`omarchy`) the agent's shell runs without the `docker` supplementary group (`id` → `artek`, `wheel`), so `docker ps` answers `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. The user `artek` is a member of the group (`getent group docker` → `docker:x:967:artek`); only the process lacks it.

Way out without `sudo`: run the command through `newgrp` with a heredoc (`sg` is not installed; `setpriv --groups` is refused):

```sh
newgrp docker <<'EOF'
docker ps --format '{{.Names}} {{.Status}}'
EOF
```

Checked 2026-11-08: it lists `email-assistant-db-1` and `email-assistant-greenmail-1`. Use it for `bun run dev:up`, `docker run --rm … oven/bun:1.3.14 …` probes and `docker build` checks. Everything inside the heredoc runs with the group; the shell outside does not.
