#!/usr/bin/env python3
"""Call the WeCom document MCP endpoint and unwrap MCP text content."""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request


sys.dont_write_bytecode = True

ENDPOINT = "https://qyapi.weixin.qq.com/mcp/robot-doc"
DEFAULT_ENV_FILE = "/workspace/.wecom-mcp.env"


class McpError(RuntimeError):
    pass


def read_apikey(env_file: str) -> str:
    try:
        st = os.stat(env_file)
    except FileNotFoundError as exc:
        raise McpError(f"API_KEY_MISSING: {env_file}") from exc

    mode = stat.S_IMODE(st.st_mode)
    if mode & 0o077:
        raise McpError(f"API_KEY_FILE_PERMISSIONS: expected 600, got {oct(mode)}")

    with open(env_file, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("WECOM_MCP_APIKEY="):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value
    raise McpError(f"API_KEY_MISSING: WECOM_MCP_APIKEY not found in {env_file}")


def unwrap_mcp_response(outer: dict) -> object:
    if "error" in outer:
        raise McpError(json.dumps(outer["error"], ensure_ascii=False))

    result = outer.get("result")
    if not isinstance(result, dict):
        raise McpError("INVALID_MCP_RESPONSE: missing result object")

    content = result.get("content")
    if not isinstance(content, list) or not content:
        raise McpError("INVALID_MCP_RESPONSE: missing result.content")

    text = content[0].get("text") if isinstance(content[0], dict) else None
    if not isinstance(text, str):
        raise McpError("INVALID_MCP_RESPONSE: missing result.content[0].text")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def call_mcp(apikey: str, tool_name: str | None, arguments: dict | None, request_id: str) -> object:
    if tool_name:
        body = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments or {}},
        }
    else:
        body = {"jsonrpc": "2.0", "id": request_id, "method": "tools/list", "params": {}}

    url = f"{ENDPOINT}?{urllib.parse.urlencode({'apikey': apikey})}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise McpError(f"HTTP_{exc.code}: {body_text}") from exc
    except urllib.error.URLError as exc:
        raise McpError(f"NETWORK_ERROR: {exc.reason}") from exc

    try:
        outer = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise McpError(f"INVALID_JSON_RESPONSE: {raw[:500]}") from exc

    if not tool_name:
        if "error" in outer:
            raise McpError(json.dumps(outer["error"], ensure_ascii=False))
        result = outer.get("result")
        if not isinstance(result, dict):
            raise McpError("INVALID_MCP_RESPONSE: missing result object")
        return result

    return unwrap_mcp_response(outer)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call WeCom document MCP tools and print unwrapped business JSON."
    )
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE)
    parser.add_argument("--tool", help="Tool name. Omit to call tools/list.")
    parser.add_argument(
        "--arguments",
        default="{}",
        help="Tool arguments as a JSON object. Defaults to {}.",
    )
    parser.add_argument("--id", default="mcp-call")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        arguments = json.loads(args.arguments)
        if not isinstance(arguments, dict):
            raise McpError("--arguments must be a JSON object")
        apikey = read_apikey(args.env_file)
        inner = call_mcp(apikey, args.tool, arguments, args.id)
        print(json.dumps(inner, ensure_ascii=False, indent=2))
        return 0
    except (json.JSONDecodeError, McpError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
