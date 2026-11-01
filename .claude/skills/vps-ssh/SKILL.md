---
name: vps-ssh
description: Runs commands and hosts apps on the azyl dev server (AI_devs, ssh mikrus_ai_devs) over SSH from the Mac. Use when a task needs a server, a deploy, a public URL, or the user says VPS, azyl or dev server.
---

# azyl dev server over SSH

## Connect

- From the Mac: `ssh -o BatchMode=yes -o ConnectTimeout=10 mikrus_ai_devs '<cmd>'`.
- Copy files: `scp -r <local> mikrus_ai_devs:<path>` or `rsync -e ssh`.
- The shell is zsh: quote URLs and globs (`"...?a=b"`), else zsh fails with `no matches found`.

## Where to work

- Work only in the home folder `/home/a/agent13816` (`~`). The server is shared; do not write anywhere else.
- Other projects and tools also use this home folder. Put this project's files in its own folder `~/email_assistant/`. Do not change or delete other projects' folders.
- `/`, `/tmp` and `/var/tmp` have a 20 MB quota. Run `export TMPDIR=$HOME/tmp` before `podman pull`, `npm`, `pip` or builds, else they fail with `disk quota exceeded`.
- No sudo: install tools in `~` (`~/.local/bin`, `pipx`, install scripts) or use a container.

## Public URL

- **https://azyl-53816.ag3nts.org** → port **53816** on azyl. HTTP only. Other ports are not public.
- With no app on 53816, the URL still returns HTTP 200 with a `<title>Error!</title>` page. Check the body.
- Never serve `~` itself (it publishes `.ssh`). Serve a project folder.
- Other projects also use port 53816. Serve this project under its own path suffix `/email_assistant/` (for example https://azyl-53816.ag3nts.org/email_assistant/). Do not replace another project's app or route.

## Containers

- `docker` is Podman (rootless), with `podman-compose`. Publish ports as `-p 127.0.0.1:<port>:<port>`.

## Ask first

Ask the user before you start a public app, delete files, or change `crontab` or `~/.ssh`.
