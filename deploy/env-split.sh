#!/usr/bin/env bash
# Moves the database keys (EA_D5_KEYS in deploy/compose-lib.sh) from .env to deploy/db.env, so the server never holds them.
# Usage (from the repo root): bash deploy/env-split.sh [--undo]
# It loses no value and keeps no backup copy: each new file is written to a temp file in its own folder, checked, then renamed;
# deploy/db.env first, .env second. A run that stopped between the two renames is finished by the next run.
# It copies lines as bytes (a value may hold `=`, `#` and spaces), never sources them, and prints key names only.
# Plan: spec/features/active/F108-e7-t5-production-on-the-vps/interfaces.md § Scripts.
set -euo pipefail

umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=deploy/compose-lib.sh
source deploy/compose-lib.sh

tmp_files=()
cleanup() { rm -f ${tmp_files[@]+"${tmp_files[@]}"}; }
trap cleanup EXIT

refuse() {
  echo "env split refused: $1" >&2
  exit 2
}

fail() {
  echo "env split failed: $1" >&2
  exit 1
}

# Writes the lines of $2 (a file) that start with a D5 key (mode keep=0) or that do not (keep=1) to $1, line by line, as bytes.
copy_lines() {
  local out="$1" source="$2" keep="$3" line key is_d5
  : >"$out"
  while IFS= read -r line || [[ -n "$line" ]]; do
    is_d5=0
    for key in "${EA_D5_KEYS[@]}"; do
      [[ "$line" == "$key="* ]] && is_d5=1
    done
    if ((is_d5 != keep)); then
      printf '%s\n' "$line" >>"$out"
    fi
  done <"$source"
}

# Prints how many lines of file $2 start with `<key>=` (key $1).
count_key() { grep -c -- "^$1=" "$2" || true; }

# Stops with a refusal when a D5 key stands twice in .env.
check_no_duplicates() {
  local key duplicated=()
  [[ -f .env ]] || return 0
  for key in "${EA_D5_KEYS[@]}"; do
    (($(count_key "$key" .env) > 1)) && duplicated+=("$key")
  done
  if ((${#duplicated[@]} > 0)); then
    refuse "key twice in .env: $(IFS=,; echo "${duplicated[*]}")"
  fi
  return 0
}

# Makes a temp file from the template $1 and sets TMP_NEW to its name (no command substitution: the exit trap must see the name).
new_temp() {
  TMP_NEW="$(mktemp "$1")" || fail "no temp file"
  tmp_files+=("$TMP_NEW")
}

undo() {
  local state tmp lines
  state="$(ea_env_split_state)"
  if [[ "$state" != split ]]; then
    echo "env split undo refused: state $state" >&2
    exit 2
  fi
  [[ -f .env ]] && check_no_duplicates
  lines="$(grep -c '' deploy/db.env || true)"
  new_temp .env.split-XXXXXX
  tmp="$TMP_NEW"
  {
    if [[ -f .env ]]; then
      cat .env
      # a .env without a final newline would glue its last line to the first moved line
      [[ -s .env && -n "$(tail -c1 .env)" ]] && echo
    fi
    cat deploy/db.env
  } >"$tmp"
  mv "$tmp" .env || fail "could not replace .env"
  rm -f deploy/db.env
  echo "env split undone moved=$lines"
}

split() {
  local state key line missing=() bad=() found=0 tmp
  state="$(ea_env_split_state)"
  if [[ "$state" == split ]]; then
    echo "env split: already split"
    return 0
  fi
  check_no_duplicates

  if [[ "$state" == old ]]; then
    for key in "${EA_D5_KEYS[@]}"; do
      found=$((found + $(count_key "$key" .env)))
    done
    new_temp deploy/.db.env.split-XXXXXX
    tmp="$TMP_NEW"
    copy_lines "$tmp" .env 0
    chmod 600 "$tmp"
    mv "$tmp" deploy/db.env || fail "could not write deploy/db.env"
    finish_env "$found" moved
    return 0
  fi

  # mixed: a stopped split has every D5 line of .env in db.env with an equal value; anything else is refused.
  if [[ ! -f deploy/db.env || ! -f .env ]]; then
    for key in POSTGRES_PASSWORD MIGRATOR_PASSWORD APP_PASSWORD; do
      [[ -f .env ]] && (($(count_key "$key" .env) == 1)) || missing+=("$key")
    done
    refuse "no complete old layout, missing: $(IFS=,; echo "${missing[*]:-.env}")"
  fi
  for key in "${EA_D5_KEYS[@]}"; do
    while IFS= read -r line; do
      found=$((found + 1))
      grep -Fxq -- "$line" deploy/db.env || bad+=("$key")
    done < <(grep -- "^$key=" .env || true)
  done
  if ((${#bad[@]} > 0)); then
    refuse "value differs between .env and deploy/db.env: $(IFS=,; echo "${bad[*]}")"
  fi
  finish_env "$found" finished
}

# Rewrites .env without the D5 lines and prints the last line. $1: count, $2: moved or finished.
finish_env() {
  local tmp
  new_temp .env.split-XXXXXX
  tmp="$TMP_NEW"
  copy_lines "$tmp" .env 1
  mv "$tmp" .env || fail "could not replace .env"
  echo "env split ok $2=$1"
}

case "${1:-}" in
  "") split ;;
  --undo) undo ;;
  *)
    echo "usage: bash deploy/env-split.sh [--undo]" >&2
    exit 2
    ;;
esac
