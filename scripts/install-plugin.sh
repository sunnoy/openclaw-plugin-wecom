#!/usr/bin/env bash
set -euo pipefail

HOST="ali-ai"
REMOTE_PLUGIN_DIR="/root/.openclaw/extensions/wecom"
REMOTE_SKILLS_DIR="/data/openclaw/skills"
RESTART_GATEWAY=1
RUN_TESTS=0
DRY_RUN=0
INSTALL_DEPS=1

SUPPORTED_SKILLS=(
  wecom-doc-manager
  wecom-preflight
  wecom-smartsheet-data
  wecom-smartsheet-schema
)

UNSUPPORTED_SKILLS=(
  wecom-contact-lookup
  wecom-edit-todo
  wecom-get-todo-detail
  wecom-get-todo-list
  wecom-meeting-create
  wecom-meeting-manage
  wecom-meeting-query
  wecom-msg
  wecom-schedule
  wecom-send-media
)

usage() {
  cat <<'EOF'
Usage: scripts/install-plugin.sh [options]

Install/sync this WeCom plugin to the OpenClaw host.

Options:
  --host <host>                 SSH host, default: ali-ai
  --plugin-dir <path>           Remote plugin dir, default: /root/.openclaw/extensions/wecom
  --skills-dir <path>           Remote shared skills dir, default: /data/openclaw/skills
  --run-tests                   Run npm test before syncing
  --skip-npm-install            Do not run npm ci on the remote plugin dir
  --skip-restart                Do not restart the OpenClaw gateway
  --dry-run                     Print rsync changes without modifying files or restarting
  -h, --help                    Show this help

The script intentionally does not sync unsupported WeCom skills. It also removes
old unsupported skill copies from the shared skills dir and empties plugin-local
skills to avoid OpenClaw loading stale duplicate skills. It also ensures the
OpenClaw core message tool stays allowed so proactive WeCom sends go through
OpenClaw's message path instead of unsupported WeCom MCP msg skills.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

log() {
  echo "==> $*"
}

shell_quote() {
  local value=$1
  case "$value" in
    *"'"*) die "single quotes are not supported in remote paths: $value" ;;
  esac
  printf "'%s'" "$value"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host)
        [[ $# -ge 2 ]] || die "--host requires a value"
        HOST=$2
        shift 2
        ;;
      --plugin-dir)
        [[ $# -ge 2 ]] || die "--plugin-dir requires a value"
        REMOTE_PLUGIN_DIR=${2%/}
        shift 2
        ;;
      --skills-dir)
        [[ $# -ge 2 ]] || die "--skills-dir requires a value"
        REMOTE_SKILLS_DIR=${2%/}
        shift 2
        ;;
      --run-tests)
        RUN_TESTS=1
        shift
        ;;
      --skip-npm-install)
        INSTALL_DEPS=0
        shift
        ;;
      --skip-restart)
        RESTART_GATEWAY=0
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1"
        ;;
    esac
  done
}

assert_repo_root() {
  [[ -f "package.json" ]] || die "run this script from the repository root"
  [[ -f "index.js" ]] || die "run this script from the repository root"
  [[ -d "wecom" ]] || die "missing wecom/ directory"
  [[ -d "skills" ]] || die "missing skills/ directory"
}

run_tests() {
  if [[ "$RUN_TESTS" -eq 1 ]]; then
    log "running npm test"
    npm test
  else
    log "skipping tests (use --run-tests to enable)"
  fi
}

sync_plugin_code() {
  local rsync_args=(
    rsync
    -av
    --delete
    --chown=root:root
    --exclude ".git/"
    --exclude "node_modules/"
    --exclude "upstream/"
    --exclude "skills/"
    ./
    "$HOST:$REMOTE_PLUGIN_DIR/"
  )

  if [[ "$DRY_RUN" -eq 1 ]]; then
    rsync_args=(rsync -avn --delete --chown=root:root
      --exclude ".git/"
      --exclude "node_modules/"
      --exclude "upstream/"
      --exclude "skills/"
      ./
      "$HOST:$REMOTE_PLUGIN_DIR/"
    )
  fi

  log "syncing plugin code to $HOST:$REMOTE_PLUGIN_DIR"
  "${rsync_args[@]}"
}

sync_supported_skills() {
  local rsync_args=(rsync -av --chown=root:root)

  if [[ "$DRY_RUN" -eq 1 ]]; then
    rsync_args=(rsync -avn --chown=root:root)
  fi

  for skill in "${UNSUPPORTED_SKILLS[@]}"; do
    rsync_args+=(--exclude "$skill/")
  done

  rsync_args+=(./skills/ "$HOST:$REMOTE_SKILLS_DIR/")

  log "syncing supported skills to $HOST:$REMOTE_SKILLS_DIR"
  "${rsync_args[@]}"
}

install_remote_dependencies() {
  if [[ "$INSTALL_DEPS" -eq 0 ]]; then
    log "skipping remote npm install"
    return
  fi

  local install_cmd="cd $(shell_quote "$REMOTE_PLUGIN_DIR") && npm ci --omit=dev"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run remote dependency install command:"
    echo "ssh $HOST $install_cmd"
    return
  fi

  log "installing remote plugin dependencies"
  ssh "$HOST" "$install_cmd"
}

cleanup_remote_skills() {
  local remove_cmd cleanup_cmd
  remove_cmd="rm -rf -- $(shell_quote "$REMOTE_PLUGIN_DIR/skills")"

  for skill in "${UNSUPPORTED_SKILLS[@]}"; do
    remove_cmd+=" $(shell_quote "$REMOTE_SKILLS_DIR/$skill")"
  done

  cleanup_cmd="$remove_cmd && mkdir -p -- $(shell_quote "$REMOTE_PLUGIN_DIR/skills") && chown root:root $(shell_quote "$REMOTE_PLUGIN_DIR/skills")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run remote cleanup command:"
    echo "ssh $HOST $cleanup_cmd"
    return
  fi

  log "emptying plugin-local skills and removing unsupported shared skills"
  ssh "$HOST" "$cleanup_cmd"
}

ensure_core_message_tool() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: would ensure tools.alsoAllow includes wecom_mcp and message"
    return
  fi

  log "ensuring OpenClaw core message tool is allowed"
  ssh "$HOST" "node" <<'NODE'
const cp = require("node:child_process");
const fs = require("node:fs");

const configPath = `${process.env.HOME}/.openclaw/openclaw.json`;
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const current = Array.isArray(config.tools?.alsoAllow) ? config.tools.alsoAllow : [];
const next = Array.from(new Set([...current, "wecom_mcp", "message"]));

if (JSON.stringify(current) === JSON.stringify(next)) {
  console.log("tools.alsoAllow already includes wecom_mcp and message");
  process.exit(0);
}

cp.execFileSync("openclaw", ["config", "set", "tools.alsoAllow", JSON.stringify(next)], {
  stdio: "inherit",
});
NODE
}

restart_gateway() {
  if [[ "$RESTART_GATEWAY" -eq 0 ]]; then
    log "skipping gateway restart"
    return
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: would restart gateway"
    return
  fi

  log "restarting OpenClaw gateway"
  ssh "$HOST" "openclaw gateway restart"
}

verify_install() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: skipping verification"
    return
  fi

  log "verifying gateway status"
  ssh "$HOST" "openclaw gateway status"

  log "verifying supported WeCom skills"
  for skill in "${SUPPORTED_SKILLS[@]}"; do
    ssh "$HOST" "openclaw skills info $skill --json >/dev/null"
    echo "ok: $skill"
  done

  log "verifying plugin-local skills are empty and unsupported skill directories are absent"
  local verify_cmd="test -d $(shell_quote "$REMOTE_PLUGIN_DIR/skills") && test -z \"\$(find $(shell_quote "$REMOTE_PLUGIN_DIR/skills") -mindepth 1 -maxdepth 1 -print -quit)\""
  for skill in "${UNSUPPORTED_SKILLS[@]}"; do
    verify_cmd+=" && test ! -e $(shell_quote "$REMOTE_SKILLS_DIR/$skill")"
  done
  ssh "$HOST" "$verify_cmd"
}

main() {
  parse_args "$@"
  assert_repo_root
  run_tests
  sync_plugin_code
  install_remote_dependencies
  sync_supported_skills
  cleanup_remote_skills
  ensure_core_message_tool
  restart_gateway
  verify_install
  log "install complete"
}

main "$@"
