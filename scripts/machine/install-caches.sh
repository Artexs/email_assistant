#!/usr/bin/env bash
# Installs the cache env file and the tmpfiles cleanup rules for this user, then enables the daily
# cleanup timer. Idempotent: a second run changes nothing. Machine-local, no root, no migration.
# Undo: delete the two installed files and run `systemctl --user disable --now systemd-tmpfiles-clean.timer`.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
changed=0

install_file() {
  local src="$1" dest="$2"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    echo "unchanged: $dest"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  install -m 644 "$src" "$dest"
  echo "installed: $dest"
  changed=1
}

install_file "$here/60-caches.conf" "$config/environment.d/60-caches.conf"
install_file "$here/caches.conf" "$config/user-tmpfiles.d/caches.conf"
mkdir -p "$HOME/.cache/node-compile-cache" "$HOME/.cache/playwright-transform-cache"

if systemctl --user is-enabled --quiet systemd-tmpfiles-clean.timer; then
  echo "unchanged: systemd-tmpfiles-clean.timer (enabled)"
else
  systemctl --user enable --now systemd-tmpfiles-clean.timer
  echo "enabled: systemd-tmpfiles-clean.timer"
  changed=1
fi

if [ "$changed" = 1 ]; then
  echo "Log out and in again: environment.d reaches shells, Herdr and Limen jobs only at login."
fi
