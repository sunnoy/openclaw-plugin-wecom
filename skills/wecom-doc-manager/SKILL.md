---
name: wecom-doc-manager
description: 企业微信文档管理技能。提供文档的创建、读取和编辑能力，支持通过 docid 或文档 URL 操作企业微信文档（doc_type=3）和智能表格（doc_type=10）。适用场景：(1) 以 Markdown 格式导出获取文档完整内容（异步轮询） (2) 新建文档或智能表格 (3) 用 Markdown 格式覆写文档内容。当用户需要查看文档内容、创建新文档、编辑文档正文时触发此 Skill。
---

# 企业微信文档管理

> `wecom_mcp` 是一个 MCP tool，所有操作通过调用该 tool 完成。

> ⚠️ **前置条件**：仅在当前会话**第一次**准备调用 `wecom_mcp`、且尚未确认工具可用时，按 `wecom-preflight` 技能执行前置条件检查。若当前回合工具列表里已经有 `wecom_mcp`，或当前会话里刚刚成功调用过 `wecom_mcp`，则**不要重复读取 `wecom-preflight`**。

> ⚠️ **路径与停止规则**：
> - 如果要读取本 skill，必须直接使用 `<available_skills>` 或 `skillsSnapshot` 中给出的精确绝对路径。
> - 不要猜测或改写为 `/data/openclaw/skills/wecom-*`、`/workspace/.openclaw/skills/...`、`/root/.openclaw/workspace-*/.openclaw/skills/...`，也不要用 `exec` + `ls/find` 探路。
> - 若 `wecom_mcp` 返回 `errcode: 846609` 或 `unsupported mcp biz type`，表示当前 bot 未开通该 category，不是路径、白名单或 sandbox 问题；立即停止继续 `read`、`list`、`find`、memory fallback 探索，直接告知用户对应 category 未开通。
> - 在读取文档前，先调用 `wecom_mcp` 执行 `list` + `category=doc` 探测当前 bot 实际暴露的 doc 工具列表。只有当列表里确实存在 `get_doc_content` 时，才允许继续调用它。
> - 如果 `list doc` 的结果中不存在 `get_doc_content`，说明当前 bot 的 doc 类 MCP 仅开放了创建/编辑能力，没有开放读取能力。此时必须立即停止，直接告诉用户“当前文档读取能力未开通”；不要再继续尝试 `get_doc_content`、浏览器抓页面、read/find/exec 探路或 HTML fallback。

管理企业微信文档的创建、读取和编辑。所有接口支持通过 `docid` 或 `url` 二选一定位文档。

## 调用方式

通过 `wecom_mcp` tool 调用，品类为 `doc`：

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc <tool_name> '<json_params>'` 调用指定技能

## 返回格式说明

所有接口返回 JSON 对象，包含以下公共字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | integer | 返回码，`0` 表示成功，非 `0` 表示失败 |
| `errmsg` | string | 错误信息，成功时为 `"ok"` |

当 `errcode` 不为 `0` 时，说明接口调用失败，可重试 1 次；若仍失败，将 `errcode` 和 `errmsg` 展示给用户。

### get_doc_content

仅当 `wecom_mcp list doc` 的结果中明确包含 `get_doc_content` 时，才可以使用本接口。

获取文档完整内容数据，只能以 Markdown 格式返回。采用**异步轮询机制**：首次调用无需传 `task_id`，接口返回 `task_id`；若 `task_done` 为 false，需携带该 `task_id` 再次调用，直到 `task_done` 为 true 时返回完整内容。

- 首次调用（不传 task_id）：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2}'`
- 轮询（携带上次返回的 task_id）：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2, "task_id": "xxx"}'`
- 或通过 URL：使用 `wecom_mcp` tool 调用 `wecom_mcp call doc get_doc_content '{"url": "https://doc.weixin.qq.com/doc/xxx", "type": 2}'`

参见 [API 详情](references/api-export-document.md)。

### create_doc

新建文档（doc_type=3）或智能表格（doc_type=10）。创建成功返回 url 和 docid。

- 使用 `wecom_mcp` tool 调用 `wecom_mcp call doc create_doc '{"doc_type": 3, "doc_name": "项目周报"}'`
- 使用 `wecom_mcp` tool 调用 `wecom_mcp call doc create_doc '{"doc_type": 10, "doc_name": "任务跟踪表"}'`

**注意**：

- `docid` 仅在创建时返回，需妥善保存。
- 创建智能表格时默认包含一个子表，可通过 `smartsheet_get_sheet` 查询其 `sheet_id`。
- **当需要把文档发给用户时，必须原样使用 `create_doc` 返回的完整 `url` 字段。**
- **不要自行根据 `docid`、短链路径或 `/doc/...` 重新拼接链接。**
- **不要删除 `url` 里的查询参数，例如 `?scode=...`。**
- 若最终回复里需要展示链接，优先直接粘贴 `create_doc` 返回的完整 `url`，不要做截短、美化或重写。

参见 [API 详情](references/api-create-doc.md)。

### edit_doc_content

用 Markdown 内容覆写文档正文。`content_type` 固定为 `1`（Markdown）。

使用 `wecom_mcp` tool 调用 `wecom_mcp call doc edit_doc_content '{"docid": "DOCID", "content": "# 标题\n\n正文内容", "content_type": 1}'`

参见 [API 详情](references/api-edit-doc-content.md)。

## 典型工作流

1. **探测当前 doc 能力** → 先调用 `wecom_mcp` 执行 `list` + `category=doc`
2. **读取文档** → 只有当第 1 步结果中存在 `get_doc_content` 时，才调用 `wecom_mcp call doc get_doc_content '{"docid": "DOCID", "type": 2}'`；若 `task_done` 为 false 则携带 `task_id` 继续轮询
3. **读取能力未开通时立即停止** → 如果第 1 步结果里没有 `get_doc_content`，直接回复用户当前 bot 未开通文档读取能力；不要改用浏览器、HTML 抓取或其他探路方式伪造结果
4. **创建新文档** → 使用 `wecom_mcp` tool 调用 `wecom_mcp call doc create_doc '{"doc_type": 3, "doc_name": "文档名"}'`，保存返回的 `docid` 和完整 `url`
5. **编辑文档** → 若第 1 步确认支持读取，可先 get_doc_content 了解当前内容，再 edit_doc_content 覆写；若不支持读取，只在用户明确提供要覆写的内容时再执行 edit
6. **回复用户链接** → 若要把新文档发给用户，直接返回第 4 步 `create_doc` 的完整 `url`；禁止自行拼接、截短或去掉查询参数

## 输出约束

当你刚创建完企业微信文档并准备回复用户时，严格遵守以下规则：

1. 只从 `create_doc` 的原始返回结果中取 `url`
2. 不要把 `docid` 转成新的链接
3. 不要删除 `?scode=...`、`from=` 等查询参数
4. 不要把链接改写成 markdown 链接文本后再手工抄写 URL
5. 如果需要摘要，摘要单独写；链接单独保留完整原文

正确示例：

```text
文档已创建，完整链接如下：
https://doc.weixin.qq.com/doc/xxx?scode=abc
```

错误示例：

```text
https://doc.weixin.qq.com/doc/xxx
```
