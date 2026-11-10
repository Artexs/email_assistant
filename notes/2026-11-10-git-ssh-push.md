# Git push from the agent shell (SSH key)

`git fetch` / `git push` to `origin` fail with `Permission denied (publickey)` in the agent shell. Cause: no `ssh-agent` is running (`SSH_AUTH_SOCK` empty), and `~/.ssh/config` has no `Host github.com` entry, so git does not find `~/.ssh/github`.

Fix: prefix every fetch/push with the env var (no file changes, no agent):

```
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"
```

`~/.ssh/github` authenticates to GitHub as `Artexs` (`ssh -T -i ~/.ssh/github -o IdentitiesOnly=yes git@github.com` → `Hi Artexs!`). The `gh` credential helper in `~/.gitconfig` works only for HTTPS remotes; this repo's remote is SSH.

Used 2026-11-10 to push the S5a worktree branch (`git push origin <sha>:refs/heads/task/s5a-web-foundation`).
