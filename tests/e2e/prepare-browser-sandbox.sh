#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${E2E_REMOTE_SSH_HOST:-ali-ai}"
MODE="${E2E_BROWSER_PREPARE_MODE:-check}" # check | install | off
PATTERN="${E2E_BROWSER_CONTAINER_PATTERN:-openclaw-sbx-agent}"
REQUIRE_READY="${E2E_BROWSER_REQUIRE_READY:-0}"

if [[ "$MODE" == "off" ]]; then
  echo "[e2e-browser] prepare mode=off, skip"
  exit 0
fi

remote_output="$(
  ssh "$SSH_HOST" "MODE='$MODE' PATTERN='$PATTERN' bash -s" <<'REMOTE'
set -euo pipefail

mode="${MODE:-check}"
pattern="${PATTERN:-openclaw-sbx-agent}"

mapfile -t rows < <(docker ps --format '{{.ID}} {{.Names}}' | awk -v p="$pattern" '$2 ~ p {print $0}')
if (( ${#rows[@]} == 0 )); then
  echo "STATUS=NO_CONTAINER"
  exit 0
fi

missing=0
for row in "${rows[@]}"; do
  cid="${row%% *}"
  name="${row#* }"

  chrome_path="$(docker exec "$cid" sh -lc 'command -v google-chrome || command -v chromium || command -v chromium-browser || true' 2>/dev/null || true)"
  browser_skill="no"
  docker exec "$cid" sh -lc '[ -f /workspace/skills/browser/SKILL.md ]' >/dev/null 2>&1 && browser_skill="yes"

  if [[ -z "$chrome_path" && "$mode" == "install" ]]; then
    docker exec "$cid" sh -lc 'DEBIAN_FRONTEND=noninteractive apt-get update -y >/tmp/e2e-apt-update.log 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y chromium fonts-liberation >/tmp/e2e-apt-install.log 2>&1' || true
    chrome_path="$(docker exec "$cid" sh -lc 'command -v google-chrome || command -v chromium || command -v chromium-browser || true' 2>/dev/null || true)"
  fi

  [[ -n "$chrome_path" ]] || missing=1
  [[ "$browser_skill" == "yes" ]] || missing=1

  echo "CONTAINER=$name CHROME=${chrome_path:-missing} BROWSER_SKILL=$browser_skill"
done

if (( missing == 0 )); then
  echo "STATUS=READY"
else
  echo "STATUS=MISSING"
fi
REMOTE
)"

echo "$remote_output"

status="$(echo "$remote_output" | awk -F= '/^STATUS=/{print $2}' | tail -n1)"
if [[ "$status" == "MISSING" && "$REQUIRE_READY" == "1" ]]; then
  echo "[e2e-browser] sandbox browser environment not ready" >&2
  exit 2
fi

exit 0
