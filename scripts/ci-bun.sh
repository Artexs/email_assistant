#!/usr/bin/env bash
# Runs bun at the version that CI and the server image use (.bun-version), through bunx.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(tr -d '[:space:]' < "${root}/.bun-version")"
exec bunx "bun@${version}" "$@"
