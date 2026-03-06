#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${E2E_REMOTE_SSH_HOST:-ali-ai}"
BOT_TEST_USER="${E2E_WECOM_TEST_USER:-wecom-e2e-user}"
AGENT_TEST_USER="${E2E_WECOM_AGENT_TEST_USER:-e2e-agent-user}"
REPRO_TEST_USER="${E2E_WECOM_REPRO_TEST_USER:-e2e-repro-user}"
DRY_RUN="${E2E_CLEANUP_DRY_RUN:-0}"

sanitize() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9_-]/_/g'
}

BOT_PREFIX="$(sanitize "$BOT_TEST_USER")"
AGENT_PREFIX="$(sanitize "$AGENT_TEST_USER")"
REPRO_PREFIX="$(sanitize "$REPRO_TEST_USER")"

readarray -t MATCH_PREFIXES <<EOF_PREFIXES
wecom-dm-${BOT_PREFIX}
wecom-*-dm-${BOT_PREFIX}
wecom-dm-${AGENT_PREFIX}
wecom-*-dm-${AGENT_PREFIX}
wecom-dm-${REPRO_PREFIX}
wecom-*-dm-${REPRO_PREFIX}
wecom-group-wr_e2e_group_
wecom-*-group-wr_e2e_group_
wecom-group-wr_repro_group_66
wecom-*-group-wr_repro_group_66
EOF_PREFIXES

prefix_json="$({
  printf '['
  first=1
  for prefix in "${MATCH_PREFIXES[@]}"; do
    if [[ $first -eq 0 ]]; then
      printf ','
    fi
    first=0
    printf '%s' "$prefix" | node -p 'JSON.stringify(require("fs").readFileSync(0, "utf8"))'
  done
  printf ']'
} )"

prefix_json_b64="$(printf '%s' "$prefix_json" | base64 | tr -d '\n')"

ssh "$SSH_HOST" PREFIX_JSON_B64="$prefix_json_b64" DRY_RUN="$DRY_RUN" 'bash -s' <<'REMOTE'
set -euo pipefail

STATE_DIR="${OPENCLAW_STATE_DIR:-${CLAWDBOT_STATE_DIR:-$HOME/.openclaw}}"
CONTAINERS_JSON="$STATE_DIR/sandbox/containers.json"

mapfile -t MATCH_PREFIXES < <(PREFIX_JSON_B64="$PREFIX_JSON_B64" node - <<'NODE'
const raw = Buffer.from(process.env.PREFIX_JSON_B64 || '', 'base64').toString('utf8');
const prefixes = JSON.parse(raw || '[]');
for (const prefix of prefixes) {
  if (prefix && typeof prefix === 'string') console.log(prefix);
}
NODE
)

if [[ ! -d "$STATE_DIR" ]]; then
  echo "[e2e-cleanup] state dir not found: $STATE_DIR"
  exit 0
fi

matches_prefix() {
  local value="$1"
  for prefix in "${MATCH_PREFIXES[@]}"; do
    if [[ "$value" == ${prefix}* ]]; then
      return 0
    fi
  done
  return 1
}

matches_container_name() {
  local name="$1"
  local stripped="$name"
  stripped="${stripped#openclaw-sbx-browser-agent-}"
  stripped="${stripped#openclaw-sbx-agent-}"
  matches_prefix "$stripped"
}

add_unique() {
  local key="$1"
  local -n target_ref="$2"
  local -n seen_ref="$3"
  [[ -n "$key" ]] || return 0
  if [[ -n "${seen_ref[$key]:-}" ]]; then
    return 0
  fi
  seen_ref[$key]=1
  target_ref+=("$key")
}

declare -a PATH_CANDIDATES=()
declare -a CONTAINER_CANDIDATES=()
declare -A PATH_SEEN=()
declare -A CONTAINER_SEEN=()

if [[ -d "$STATE_DIR/agents" ]]; then
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    base="$(basename "$path")"
    if matches_prefix "$base"; then
      add_unique "$path" PATH_CANDIDATES PATH_SEEN
    fi
  done < <(find "$STATE_DIR/agents" -mindepth 1 -maxdepth 1 -type d | sort)
fi

while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  base="$(basename "$path")"
  agent_id="${base#workspace-}"
  if [[ "$agent_id" != "$base" ]] && matches_prefix "$agent_id"; then
    add_unique "$path" PATH_CANDIDATES PATH_SEEN
  fi
done < <(find "$STATE_DIR" -mindepth 1 -maxdepth 1 -type d -name 'workspace-*' | sort)

if command -v docker >/dev/null 2>&1; then
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if matches_container_name "$name"; then
      add_unique "$name" CONTAINER_CANDIDATES CONTAINER_SEEN
    fi
  done < <(docker ps -a --format '{{.Names}}' 2>/dev/null || true)
fi

matched_meta_file="$(mktemp)"
cleanup_meta_file() {
  rm -f "$matched_meta_file"
}
trap cleanup_meta_file EXIT

if [[ -f "$CONTAINERS_JSON" ]]; then
  PREFIX_JSON_B64="$PREFIX_JSON_B64" \
  CONTAINERS_JSON="$CONTAINERS_JSON" \
  DRY_RUN="$DRY_RUN" \
  node - <<'NODE' > "$matched_meta_file"
const fs = require('fs');
const raw = Buffer.from(process.env.PREFIX_JSON_B64 || '', 'base64').toString('utf8');
const prefixes = JSON.parse(raw || '[]');
const file = process.env.CONTAINERS_JSON;
const dryRun = process.env.DRY_RUN === '1';

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

const regexes = prefixes.map((prefix) => {
  const source = '^' + escapeRegExp(String(prefix)).replace(/\\\*/g, '.*');
  return new RegExp(source);
});

function matches(value) {
  const text = String(value || '');
  return regexes.some((regex) => regex.test(text));
}

function extractAgentId(entry) {
  const sessionKey = String(entry?.sessionKey || '');
  if (sessionKey.startsWith('agent:')) {
    return sessionKey.slice('agent:'.length);
  }
  return '';
}

function stripContainerPrefix(name) {
  return String(name || '')
    .replace(/^openclaw-sbx-browser-agent-/, '')
    .replace(/^openclaw-sbx-agent-/, '');
}

let json;
try {
  json = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  json = { entries: [] };
}

const entries = Array.isArray(json.entries) ? json.entries : [];
const kept = [];
const matched = [];
for (const entry of entries) {
  const agentId = extractAgentId(entry);
  const containerName = String(entry?.containerName || '');
  const strippedName = stripContainerPrefix(containerName);
  const shouldRemove = matches(agentId) || matches(strippedName);
  if (shouldRemove) {
    matched.push(containerName || agentId);
  } else {
    kept.push(entry);
  }
}

if (!dryRun && kept.length !== entries.length) {
  json.entries = kept;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

for (const name of matched) {
  if (name) console.log(name);
}
NODE
fi

while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  add_unique "$name" CONTAINER_CANDIDATES CONTAINER_SEEN
done < "$matched_meta_file"

removed_paths=0
for path in "${PATH_CANDIDATES[@]}"; do
  case "$path" in
    "$STATE_DIR"/agents/*|"$STATE_DIR"/workspace-*) ;;
    *)
      echo "[e2e-cleanup] skip unsafe path: $path"
      continue
      ;;
  esac

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[e2e-cleanup] DRY_RUN would remove $path"
    continue
  fi

  rm -rf -- "$path"
  removed_paths=$((removed_paths + 1))
  echo "[e2e-cleanup] removed $path"
done

removed_containers=0
for name in "${CONTAINER_CANDIDATES[@]}"; do
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[e2e-cleanup] DRY_RUN would remove container $name"
    continue
  fi

  if command -v docker >/dev/null 2>&1; then
    if docker rm -f "$name" >/dev/null 2>&1; then
      removed_containers=$((removed_containers + 1))
      echo "[e2e-cleanup] removed container $name"
    else
      echo "[e2e-cleanup] container already absent or not removable: $name"
    fi
  else
    echo "[e2e-cleanup] docker not available, skipped container $name"
  fi
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[e2e-cleanup] dry run complete"
else
  echo "[e2e-cleanup] removed $removed_paths path(s) and $removed_containers container(s)"
fi
REMOTE
