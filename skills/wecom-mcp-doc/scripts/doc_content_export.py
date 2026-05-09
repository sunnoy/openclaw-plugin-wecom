#!/usr/bin/env python3
"""Export WeCom document content with get_doc_content polling."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime

sys.dont_write_bytecode = True

from mcp_call import McpError, call_mcp, read_apikey


def safe_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return stem[:80] or "wecom-doc"


def default_output_path(docid: str | None, url: str | None) -> str:
    source = docid or url or "wecom-doc"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return os.path.abspath(f"{safe_stem(source)}-{stamp}.md")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Submit get_doc_content, poll until done, and write content to a file."
    )
    locator = parser.add_mutually_exclusive_group(required=True)
    locator.add_argument("--docid")
    locator.add_argument("--url")
    parser.add_argument("--type", type=int, default=2, help="get_doc_content type. Default: 2.")
    parser.add_argument("--out", help="Output file path. Defaults to ./<docid>-<timestamp>.md")
    parser.add_argument("--polls", type=int, default=20)
    parser.add_argument("--interval", type=float, default=1.5)
    parser.add_argument("--env-file", default="/workspace/.wecom-mcp.env")
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary.")
    return parser.parse_args()


def build_arguments(args: argparse.Namespace, task_id: str | None) -> dict:
    arguments = {"type": args.type}
    if args.docid:
        arguments["docid"] = args.docid
    else:
        arguments["url"] = args.url
    if task_id:
        arguments["task_id"] = task_id
    return arguments


def main() -> int:
    args = parse_args()
    out_path = os.path.abspath(args.out) if args.out else default_output_path(args.docid, args.url)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    try:
        apikey = read_apikey(args.env_file)
        task_id = None
        last_inner = None

        for index in range(args.polls):
            inner = call_mcp(
                apikey,
                "get_doc_content",
                build_arguments(args, task_id),
                f"get-doc-content-{index + 1}",
            )
            if not isinstance(inner, dict):
                raise McpError(f"UNEXPECTED_RESULT: {inner!r}")

            last_inner = inner
            if inner.get("errcode") not in (None, 0):
                raise McpError(json.dumps(inner, ensure_ascii=False))

            task_id = task_id or inner.get("task_id")
            if inner.get("task_done"):
                content = inner.get("content", "")
                if not isinstance(content, str):
                    raise McpError("INVALID_CONTENT: content is not a string")
                with open(out_path, "w", encoding="utf-8") as fh:
                    fh.write(content)
                summary = {
                    "ok": True,
                    "path": out_path,
                    "chars": len(content),
                    "task_id": task_id,
                    "polls": index + 1,
                }
                if args.json:
                    print(json.dumps(summary, ensure_ascii=False, indent=2))
                else:
                    print(f"Done: {len(content)} chars -> {out_path}")
                    if task_id:
                        print(f"task_id: {task_id}")
                return 0

            if not task_id:
                raise McpError("TASK_ID_MISSING: async result did not include task_id")

            if not args.json:
                print(f"Poll {index + 1}: task_done=false, waiting {args.interval}s...", file=sys.stderr)
            time.sleep(args.interval)

        summary = {
            "ok": False,
            "error": "POLLING_EXHAUSTED",
            "task_id": task_id,
            "last_result": last_inner,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2
    except McpError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
