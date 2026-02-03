#!/usr/bin/env bash
#
# jumper-wrapper.sh - jumper 工具的 wrapper 脚本
#
# 用法:
#   ./jumper-wrapper.sh exec <ip> -- <command>...
#   ./jumper-wrapper.sh acl-check <command>
#   ./jumper-wrapper.sh acl-list
#

set -euo pipefail

# 禁用历史扩展，避免 ! 被转义
set +H 2>/dev/null || true

load_dotenv() {
    local env_file="$1"
    [[ -f "$env_file" ]] || return 0

    # 以“纯文本 key=value”解析 .env，避免用 `source` 带来的转义/执行差异：
    # - Windows 路径里的反斜杠（C:\Users\...）在 bash `source` 下会被当作转义符，导致路径被破坏
    # - 也避免执行任意 shell 语句
    local line name value
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ -z "$line" ]] && continue
        [[ "$line" == \#* ]] && continue

        # 兼容 "export KEY=VALUE"
        if [[ "$line" == export[[:space:]]* ]]; then
            line="${line#export }"
            line="${line#"${line%%[![:space:]]*}"}"
        fi

        [[ "$line" == *"="* ]] || continue

        name="${line%%=*}"
        value="${line#*=}"

        # trim spaces around name
        name="${name#"${name%%[![:space:]]*}"}"
        name="${name%"${name##*[![:space:]]}"}"

        # 仅允许合法的 env var 名称
        [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

        # Strip optional surrounding quotes (best-effort)
        if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
            value="${value:1:${#value}-2}"
        elif [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
            value="${value:1:${#value}-2}"
        fi

        export "$name=$value"
    done <"$env_file"
}

# 加载环境变量（如果 .env 文件存在）
ENV_FILE="/workspace/.env"
load_dotenv "$ENV_FILE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# jumper 二进制文件位置
# 优先使用 tools/jumper 目录下编译好的二进制
JUMPER_BIN=""

find_jumper_binary() {
    JUMPER_BIN="/workspace/bin/jumper"
    if [[ -x "$JUMPER_BIN" ]]; then
        return 0
    fi
    return 1
}

check_env_vars() {
    local missing=()

    # 检查 TOTP 密钥（至少需要一个）
    if [[ -z "${MFA_TOTP_SECRET_PRI:-}" ]] && [[ -z "${MFA_TOTP_SECRET_TX:-}" ]]; then
        missing+=("MFA_TOTP_SECRET_PRI 或 MFA_TOTP_SECRET_TX")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "警告: 以下环境变量未设置:" >&2
        for var in "${missing[@]}"; do
            echo "  - $var" >&2
        done
        echo "" >&2
        echo "请设置相应的 TOTP 密钥环境变量后再试。" >&2
        return 1
    fi

    return 0
}

show_usage() {
    cat <<EOF
jumper-wrapper.sh - JumpServer SSH 客户端 wrapper

用法:
  $0 exec <IP> [选项] -- <command>...                       在远程服务器执行命令
  $0 exec <IP> [选项] --stdin                               从 stdin 读取命令并执行（推荐用于特殊字符）
  $0 scp <IP> --download <远程路径> <本地路径>               从服务器下载文件
  $0 scp <IP> --upload <本地路径> <远程路径>                 上传文件到服务器
  $0 acl-check <command> [--env <ENV>]                     检查命令是否被 ACL 允许
  $0 acl-list                                              列出所有 ACL 规则

exec/scp 选项:
  -e, --env <ENV>     强制指定环境 (pri/tx)
  -u, --user <USER>   指定用户名
  -r, --recursive     递归传输目录 (仅 scp)
  -v, --verbose       详细输出
  --debug             调试模式
  --stdin             从 stdin 读取命令（可配合 heredoc，避免 zsh 的历史扩展等问题）

环境:
  pri    私有数据中心 (172.0.0.0/8)
  tx     腾讯云 (10.0.4.0/22)

环境变量:
  MFA_TOTP_SECRET_PRI   pri 环境 TOTP 密钥
  MFA_TOTP_SECRET_TX    tx 环境 TOTP 密钥
  JMSSH_USER            堡垒机用户名
  JMSSH_KEY_PRI         pri 环境 SSH 私钥路径
  JMSSH_KEY_TX          tx 环境 SSH 私钥路径

示例:
  # 基础命令
  $0 exec 172.16.1.12 -- ls -la
  $0 exec 172.16.1.12 --env pri -- df -h

  # 文件传输
  $0 scp 10.0.7.244 --download /var/log/messages /tmp/messages.log
  $0 scp 10.0.7.244 --upload ./config.yaml /etc/app/config.yaml

  # 中间件命令（特殊字符自动处理）
  $0 exec 10.0.7.244 -- "kubectl exec -n default mysql-pod -- mysql -uroot -p'Pa\$\$!123' -e 'SHOW TABLES;'"
  $0 exec 10.0.7.244 -- "kubectl exec -n default redis-pod -- redis-cli -a 'pass!@#' KEYS '*'"

  # 中间件命令（推荐：stdin 模式，避免特殊字符/历史扩展）
  cat <<'CMD' | $0 exec 10.0.7.244 --stdin
kubectl exec -n default mysql-pod -- mysql -uroot -p'Pa\$\$!123' -e 'SHOW TABLES;'
CMD

  # ACL 检查
  $0 acl-check "rm -rf /"
  $0 acl-list

EOF
}

main() {
    if [[ $# -eq 0 ]] || [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
        show_usage
        exit 0
    fi

    # 查找 jumper 二进制
    if ! find_jumper_binary; then
        echo "错误: 找不到 jumper 二进制文件" >&2
        echo "" >&2
        echo "请确保 bin/ 目录下有对应平台的二进制文件" >&2
        exit 1
    fi

    # 检查环境变量
    if ! check_env_vars; then
        exit 1
    fi

    # exec 命令特殊处理：直接透传命令 argv（不再使用 base64）
    if [[ "$1" == "exec" ]]; then
        shift  # 移除 "exec"

        local ip=""
        local jumper_args=()
        local cmd_args=()
        local found_separator=false
        local use_stdin=false

        # 解析参数
        while [[ $# -gt 0 ]]; do
            if [[ "$1" == "--stdin" ]]; then
                use_stdin=true
            elif [[ "$1" == "--force-acl" ]]; then
                # 已废弃参数：jumper 目前不支持该 flag；为兼容旧脚本在 wrapper 层忽略
                :
            elif [[ "$1" == "--" ]]; then
                found_separator=true
                shift
                break
            elif [[ -z "$ip" ]] && [[ "$1" != -* ]]; then
                ip="$1"
            else
                jumper_args+=("$1")
            fi
            shift
        done

        # 收集 -- 后面的命令
        while [[ $# -gt 0 ]]; do
            cmd_args+=("$1")
            shift
        done

        if [[ -z "$ip" ]]; then
            echo "错误: 未指定 IP 地址" >&2
            exit 1
        fi

        if [[ "$use_stdin" == true ]]; then
            if [[ ${#cmd_args[@]} -gt 0 ]]; then
                echo "错误: 使用 --stdin 时不应再提供 -- 后的命令参数" >&2
                exit 1
            fi
            if [[ -t 0 ]]; then
                echo "错误: --stdin 模式需要从 stdin 读取命令，请使用管道或 heredoc" >&2
                echo "示例: cat <<'CMD' | $0 exec $ip --stdin" >&2
                exit 1
            fi

            local cmd_str
            cmd_str="$(cat)"
            # 修复 zsh 对 ! 的转义（如用户使用了 \"\\!\"）
            cmd_str="${cmd_str//\\!/!}"
            if [[ -z "$cmd_str" ]]; then
                echo "错误: stdin 为空，未读取到要执行的命令" >&2
                exit 1
            fi

            if [[ ${#jumper_args[@]} -gt 0 ]]; then
                "$JUMPER_BIN" exec "$ip" "${jumper_args[@]}" -- "$cmd_str"
            else
                "$JUMPER_BIN" exec "$ip" -- "$cmd_str"
            fi
            exit $?
        fi

        if [[ ${#cmd_args[@]} -eq 0 ]]; then
            echo "错误: 未指定要执行的命令" >&2
            exit 1
        fi

        # 修复 zsh 对 ! 的转义（如用户使用了 \"\\!\"）
        local i
        for i in "${!cmd_args[@]}"; do
            cmd_args[$i]="${cmd_args[$i]//\\!/!}"
        done

        if [[ ${#jumper_args[@]} -gt 0 ]]; then
            "$JUMPER_BIN" exec "$ip" "${jumper_args[@]}" -- "${cmd_args[@]}"
        else
            "$JUMPER_BIN" exec "$ip" -- "${cmd_args[@]}"
        fi
        exit $?
    fi

    # 其他命令直接传递给 jumper
    exec "$JUMPER_BIN" "$@"
}

main "$@"
