#!/usr/bin/env bash
# The one place that builds the Compose command of the deploy scripts (release-lib.sh, backup.sh, logs.sh, restore.sh).
# Source it from the repo root; it runs nothing by itself. Plan: spec/features/active/F108-e7-t5-production-on-the-vps/interfaces.md.
#
# Compose reads the passwords for the database URLs from one interpolation file. On a host with the env split that file is
# deploy/db.env; on a host without it, the old .env. The server container never gets db.env (ADR 0019 is the decision record).

# The database keys that leave the server env on the VPS (the one list; check-server-env.sh and env-split.sh read it).
EA_D5_KEYS=(POSTGRES_PASSWORD MIGRATOR_PASSWORD APP_PASSWORD MIGRATOR_DATABASE_URL)

# Sets EA_COMPOSE_FILES and EA_COMPOSE. Return 2 when neither env file exists.
ea_compose_init() {
  local env_file
  if [[ -f deploy/db.env ]]; then
    env_file=deploy/db.env
  elif [[ -f .env ]]; then
    env_file=.env
  else
    echo "compose: no deploy/db.env and no .env" >&2
    return 2
  fi
  EA_COMPOSE_FILES=(-f deploy/compose.yaml --env-file "$env_file")
  EA_COMPOSE=(docker compose "${EA_COMPOSE_FILES[@]}")
}

# Prints one word: split, old or mixed. A key counts only as a line that starts with `<KEY>=`.
#   split: deploy/db.env exists and .env holds no D5 key.
#   old:   no deploy/db.env and .env holds the three password keys (MIGRATOR_DATABASE_URL may be there too).
#   mixed: any other case.
ea_env_split_state() {
  local key in_env=0 passwords=0 has_db=0
  [[ -f deploy/db.env ]] && has_db=1
  for key in "${EA_D5_KEYS[@]}"; do
    if [[ -f .env ]] && grep -q -- "^${key}=" .env; then
      in_env=$((in_env + 1))
      [[ "$key" != MIGRATOR_DATABASE_URL ]] && passwords=$((passwords + 1))
    fi
  done
  if ((has_db == 1 && in_env == 0)); then
    echo split
  elif ((has_db == 0 && passwords == 3)); then
    echo old
  else
    echo mixed
  fi
}
