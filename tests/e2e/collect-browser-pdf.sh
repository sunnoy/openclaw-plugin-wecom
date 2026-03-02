#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${E2E_REMOTE_SSH_HOST:-ali-ai}"
REMOTE_COLLECT_DIR="${E2E_REMOTE_PDF_COLLECT_DIR:-/tmp/openclaw-e2e-artifacts}"
LOOKBACK_MIN="${E2E_PDF_LOOKBACK_MIN:-240}"
PATTERN="${E2E_BROWSER_CONTAINER_PATTERN:-openclaw-sbx-agent}"
LOCAL_OUTPUT_DIR="${E2E_PDF_OUTPUT_DIR:-tests/e2e/artifacts}"

abs_local_dir="$LOCAL_OUTPUT_DIR"
if [[ "$abs_local_dir" != /* ]]; then
  abs_local_dir="$(pwd)/$abs_local_dir"
fi
mkdir -p "$abs_local_dir"

ssh "$SSH_HOST" "REMOTE_COLLECT_DIR='$REMOTE_COLLECT_DIR' LOOKBACK_MIN='$LOOKBACK_MIN' PATTERN='$PATTERN' bash -s" <<'REMOTE'
set -euo pipefail
collect_dir="${REMOTE_COLLECT_DIR:-/tmp/openclaw-e2e-artifacts}"
lookback="${LOOKBACK_MIN:-240}"
pattern="${PATTERN:-openclaw-sbx-agent}"

rm -rf "$collect_dir"
mkdir -p "$collect_dir"

count=0
while read -r cid name; do
  [[ -n "$cid" ]] || continue
  while read -r pdf; do
    [[ -n "$pdf" ]] || continue
    safe_name="$(echo "${name}_$(basename "$pdf")" | tr '/ :' '__')"
    if docker cp "$cid:$pdf" "$collect_dir/$safe_name" >/dev/null 2>&1; then
      count=$((count + 1))
      echo "COPIED=$name:$pdf -> $collect_dir/$safe_name"
    fi
  done < <(docker exec "$cid" sh -lc "find /workspace -type f -name '*.pdf' -mmin -${lookback} 2>/dev/null | head -n 30" || true)
done < <(docker ps --format '{{.ID}} {{.Names}}' | awk -v p="$pattern" '$2 ~ p {print $1, $2}')

echo "COUNT=$count"
REMOTE

if ssh "$SSH_HOST" "test -d '$REMOTE_COLLECT_DIR' && test \"\$(ls -A '$REMOTE_COLLECT_DIR' 2>/dev/null | wc -l)\" -gt 0"; then
  ssh "$SSH_HOST" "tar -C '$REMOTE_COLLECT_DIR' -cf - ." | tar -C "$abs_local_dir" -xf -
  echo "[e2e-pdf] downloaded PDFs to: $abs_local_dir"
  ls -la "$abs_local_dir"
else
  echo "[e2e-pdf] no pdf artifacts found in remote sandbox containers"
fi
