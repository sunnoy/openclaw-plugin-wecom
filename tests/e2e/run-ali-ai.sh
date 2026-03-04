#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SSH_HOST="${E2E_REMOTE_SSH_HOST:-ali-ai}"
REMOTE_PORT="${E2E_REMOTE_OPENCLAW_PORT:-18789}"
LOCAL_PORT="${E2E_LOCAL_TUNNEL_PORT:-28789}"

fetch_remote_wecom_config() {
  ssh "$SSH_HOST" "node -e \"const fs=require('fs');const p=process.env.HOME+'/.openclaw/openclaw.json';const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const w=cfg?.channels?.wecom||{};const a=w.agent||{};process.stdout.write(JSON.stringify({token:w.token||'',aes:w.encodingAesKey||'',path:w.webhookPath||'/webhooks/wecom',agentToken:a.token||'',agentAes:a.encodingAesKey||'',corpId:a.corpId||'',corpSecret:a.corpSecret||'',agentId:String(a.agentId||'')}));\""
}

apply_remote_env() {
  local remote_json="$1"
  mapfile -t env_lines < <(node -e "
    const v=JSON.parse(process.argv[1]);
    if(!v.token||!v.aes){process.exit(9);}
    console.log('E2E_WECOM_TOKEN='+v.token);
    console.log('E2E_WECOM_ENCODING_AES_KEY='+v.aes);
    console.log('E2E_WECOM_WEBHOOK_PATH='+v.path);
    if(v.agentToken) console.log('E2E_WECOM_AGENT_TOKEN='+v.agentToken);
    if(v.agentAes) console.log('E2E_WECOM_AGENT_ENCODING_AES_KEY='+v.agentAes);
    if(v.corpId) console.log('E2E_WECOM_AGENT_CORP_ID='+v.corpId);
    if(v.corpSecret) console.log('E2E_WECOM_AGENT_CORP_SECRET='+v.corpSecret);
    if(v.agentId) console.log('E2E_WECOM_AGENT_ID='+v.agentId);
  " "$remote_json")
  for entry in "${env_lines[@]}"; do
    export "$entry"
  done
}

SOCK_FILE="$(mktemp -u /tmp/openclaw-e2e-ssh-XXXXXX.sock)"
cleanup() {
  ssh -S "$SOCK_FILE" -O exit "$SSH_HOST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

REMOTE_JSON="$(fetch_remote_wecom_config)"
if ! apply_remote_env "$REMOTE_JSON"; then
  echo "[e2e] failed to parse remote wecom config from ${SSH_HOST}" >&2
  exit 1
fi
if [[ -z "${E2E_WECOM_TOKEN:-}" || -z "${E2E_WECOM_ENCODING_AES_KEY:-}" ]]; then
  echo "[e2e] missing token/encodingAesKey in remote config on ${SSH_HOST}" >&2
  exit 1
fi

ssh -M -S "$SOCK_FILE" -fnNT -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" "$SSH_HOST"

export E2E_WECOM_BASE_URL="http://127.0.0.1:${LOCAL_PORT}"
export NO_PROXY="127.0.0.1,localhost"

cd "$PROJECT_ROOT"
echo "[e2e] target=${SSH_HOST} tunnel=127.0.0.1:${LOCAL_PORT}->127.0.0.1:${REMOTE_PORT} webhook=${E2E_WECOM_WEBHOOK_PATH}"

if [[ "${E2E_BROWSER_PREPARE_MODE:-check}" != "off" ]]; then
  set +e
  browser_prepare_output="$(
    E2E_REMOTE_SSH_HOST="$SSH_HOST" \
    E2E_BROWSER_PREPARE_MODE="${E2E_BROWSER_PREPARE_MODE:-check}" \
    E2E_BROWSER_REQUIRE_READY="${E2E_BROWSER_REQUIRE_READY:-0}" \
    bash "$SCRIPT_DIR/prepare-browser-sandbox.sh" 2>&1
  )"
  prepare_exit=$?
  set -e
  echo "$browser_prepare_output"
  if (( prepare_exit != 0 )); then
    exit "$prepare_exit"
  fi
  browser_status="$(echo "$browser_prepare_output" | awk -F= '/^STATUS=/{print $2}' | tail -n1)"
  if [[ "$browser_status" == "READY" ]]; then
    export E2E_BROWSER_SANDBOX_READY=1
  else
    export E2E_BROWSER_SANDBOX_READY=0
  fi
else
  export E2E_BROWSER_SANDBOX_READY=0
fi

set +e
node --test tests/e2e/*.e2e.test.js "$@"
test_exit=$?
set -e

if [[ "${E2E_COLLECT_BROWSER_PDF:-1}" == "1" ]]; then
  E2E_REMOTE_SSH_HOST="$SSH_HOST" \
  E2E_BROWSER_CONTAINER_PATTERN="${E2E_BROWSER_CONTAINER_PATTERN:-openclaw-sbx-agent}" \
  E2E_PDF_OUTPUT_DIR="${E2E_PDF_OUTPUT_DIR:-$PROJECT_ROOT/tests/e2e/artifacts}" \
  bash "$SCRIPT_DIR/collect-browser-pdf.sh" || true
fi

exit "$test_exit"
