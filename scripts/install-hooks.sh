#!/usr/bin/env bash
# Installs the pre-commit hook into the shared .git/hooks (every worktree of this repository uses it).
# Idempotent. scripts/limen-prepare.sh calls it for each job. It keeps the post-commit and post-merge hooks as they are.
set -euo pipefail
hooks="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$hooks"
cat >"$hooks/pre-commit.tmp" <<'EOF'
#!/usr/bin/env bash
# Installed by scripts/install-hooks.sh. A checkout without the script (an old branch) skips the check.
top=$(git rev-parse --show-toplevel)
[ -f "$top/scripts/pre-commit.sh" ] || exit 0
exec bash "$top/scripts/pre-commit.sh"
EOF
chmod +x "$hooks/pre-commit.tmp"
mv "$hooks/pre-commit.tmp" "$hooks/pre-commit"
