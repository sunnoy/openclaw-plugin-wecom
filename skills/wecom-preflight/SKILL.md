---
name: wecom-preflight
description: WeCom MCP 文档/智能表格调用前置检查。仅当已经决定调用 `wecom_mcp` 的 doc 类能力时使用；不要用于给企业微信用户或群发消息、联系人查询、日程、会议或待办。发消息必须使用 OpenClaw core `message` 工具。
---

# 企业微信前置检查

> 本技能只用于判断当前会话能否继续使用 `wecom_mcp`。
> 在 agent sandbox 内，**不要**执行宿主机级别的 `openclaw config ...` 或 `openclaw gateway restart`。
> 本技能**不适用于发消息**。用户要求“给某人/群发消息、转发、通知”时，禁止调用 `wecom_mcp` 的 `msg` category；应使用 OpenClaw core `message` 工具（`action="send"`、`channel="wecom"`）。如果当前工具列表没有 `message`，直接说明宿主机需要把 `message` 加入 `tools.alsoAllow`，不要改用 `wecom_mcp`。

> ⚠️ **路径与停止规则**：
> - 如果要读取 WeCom skill，必须直接使用 `<available_skills>` 或 `skillsSnapshot` 中给出的精确绝对路径。
> - 不要猜测或改写为 `/data/openclaw/skills/wecom-*`、`/workspace/.openclaw/skills/...`、`/root/.openclaw/workspace-*/.openclaw/skills/...`，也不要用 `exec` + `ls/find` 探路。
> - 若 `wecom_mcp` 返回 `errcode: 846609` 或 `unsupported mcp biz type`，表示当前 bot 未开通该 category，不是路径、白名单或 sandbox 问题；立即停止继续 `read`、`list`、`find`、memory fallback 探索，直接告知用户对应 category 未开通。

## 何时使用

在以下场景使用本技能：

1. 当前会话第一次准备调用 `wecom_mcp`
2. 调用 `wecom_mcp` 后返回 `tool not allowed`、`not permitted`、`permission denied`
3. 你怀疑当前环境没有把 WeCom MCP 正确暴露给 agent

如果当前会话里 `wecom_mcp` 已经成功调用过一次，就不要重复执行本技能。

## 当前部署的正确做法

本项目的 `wecom_mcp` 是否可用，取决于 **宿主机 OpenClaw 配置** 和 **sandbox 挂载**，不是由 agent 自己在容器里动态修复。

因此：

- 可以继续直接调用 `wecom_mcp` 的前提：工具已经出现在当前会话可用工具中，或你刚刚已经成功调用过
- 不可以做的事：在 sandbox 里执行 `openclaw config get ...`、`openclaw config set ...`、`openclaw gateway restart`
- 如果工具不可用，应该停止继续试探，并明确告知用户或管理员去宿主机修复

## 检查流程

### 情况 A：`wecom_mcp` 已可用

满足任一条件即可视为通过：

- 当前回合工具列表里已经有 `wecom_mcp`
- 当前会话里之前已经成功调用过 `wecom_mcp`

处理方式：

- 直接继续执行原始 WeCom 技能
- 不要再做额外的 shell 探测

### 情况 B：返回工具权限错误

如果错误类似：

- `tool not allowed`
- `not permitted`
- `permission denied`
- `unknown tool: wecom_mcp`

这说明问题在 **宿主机工具放行配置**，不是当前业务参数错误。

处理方式：

- 立即停止继续试探
- 明确告知用户：需要在宿主机上把 `wecom_mcp` 加入允许列表，并在必要时重启 gateway
- 不要在 sandbox 内尝试修复

可对用户说明：

```text
当前会话所在的 agent sandbox 里还不能使用 wecom_mcp。这个问题需要在宿主机 OpenClaw 配置里放行 wecom_mcp，并在必要时重启 gateway 后才会生效；我无法在当前 sandbox 内直接执行这类宿主机配置。
```

### 情况 C：返回 MCP 业务错误

如果 `wecom_mcp` 工具本身可调用，但返回类似下面的业务错误：

- `unsupported mcp biz type`
- `errcode: 846609`

这说明：

- 工具权限通常已经没问题
- 但当前机器人或当前企业微信侧 **没有开通对应 category**，例如只开了 `doc`，没有开 `schedule`

处理方式：

- 不要再把它误判成“tool 未放行”
- 直接告诉用户：当前业务类型未开通，需要企业微信侧补充对应 MCP 配置

## 决策规则

| 现象 | 结论 | 动作 |
| --- | --- | --- |
| `wecom_mcp` 已成功调用 | 前置检查通过 | 继续原始任务 |
| `tool not allowed` / `unknown tool` | 宿主机未放行工具 | 停止试探，提示宿主机修复 |
| `unsupported mcp biz type` / `846609` | 对应业务类型未开通 | 停止试探，提示开通对应 category |
| 其他业务报错 | 接口调用失败 | 按具体错误处理，不要误改环境 |

## 关键约束

1. 本技能是 **判断与分流**，不是在 sandbox 内自动修配置。
2. 绝不要在当前容器里执行宿主机级别的 OpenClaw 配置命令。
3. 一旦确认是宿主机配置问题或企业微信侧未开通问题，就停止重复探索，直接给出明确结论。
