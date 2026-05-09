# 官方插件对齐迁移方案

> 基准日期：2026-04-27
> 官方上游：`@wecom/wecom-openclaw-plugin@2026.4.23`（dist-tags.latest）
> SDK 上游：`@wecom/aibot-node-sdk@1.0.6`（dist-tags.latest）
> 本仓库快照：`upstream/wecom-openclaw-plugin-1.0.13/`（2026-03-18）

## 背景与原则

本仓库定位为**官方 `@wecom/wecom-openclaw-plugin` 的增强插件**（README.md:6）。官方于 2026-04-07 进行了一次架构级重写（commit `2bf87b0`），吸收了本 fork 的 Agent/Webhook 双模、多账号、动态 Agent 思路，并新增了 Template Card、SmartPage、MCP interceptor 等能力；2026-04-22（commit `6f3ed44`）再次新增文档读取能力。

迁移原则：

1. **官方实现优先**：有官方等价实现的，以官方为基础叠加本插件增量，不再维护平行实现
2. **增量只在上层**：本插件独有能力（`dynamicAgents.adminBypass`、`bindings`、`workspaceTemplate`、`runtime-telemetry`、多账号增强出站等）继续维护，在官方骨架上叠加
3. **每个 PR 独立可回滚**：分四个 PR 按序合并，任意一个失败不影响前序成果；具体回滚命令见“通用回滚流程”

## 版本规划

| PR | 发布版本 | 内容摘要 |
| --- | --- | --- |
| PR-1 | `v3.1.0` | 基线追平：SDK 升级 + upstream/skill 同步 + README 修订；不升级 MCP 协商版本 |
| PR-2 | `v3.2.0` | 可靠性对齐：stream fallback + SDK 重连错误体系 + video 入站 |
| PR-3 | `v3.3.0` | 新能力：MCP 协商版本升级 + Template Card + SmartPage + MCP interceptors |
| PR-4 | `v3.4.0` | 性能优化：crypto 替换 + replyStreamNonBlocking |

## PR 依赖关系

```
PR-1（基线追平）
    ↓ 必须先合并
PR-2（可靠性对齐）   PR-3（新能力 + MCP 协商版本升级）
         ↓             ↓
        PR-4（性能优化）
```

## 通用回滚流程

每个 PR 的回滚必须同时覆盖本地代码、远端插件目录、共享 skill 目录和 gateway 进程：

1. **代码回滚**

   ```bash
   # GitHub merge commit:
   git revert -m 1 <pr-merge-commit-sha>

   # Squash merge / 普通 commit:
   git revert <squash-or-commit-sha>

   npm test
   ```

2. **同步插件代码**（不含 `skills/`，保持远端目录 `root:root`）

   ```bash
   rsync -av --delete --chown=root:root \
     --exclude ".git/" \
     --exclude "node_modules/" \
     --exclude "upstream/" \
     --exclude "skills/" \
     ./ ali-ai:/root/.openclaw/extensions/wecom/
   ```

3. **回退 skill 目录**（仅当该 PR 改过 `skills/`）

   ```bash
   rsync -av --chown=root:root ./skills/ ali-ai:/data/openclaw/skills/
   ```

   不要对 `/data/openclaw/skills/` 使用 `--delete`，避免删除非 wecom skill。若回滚的是新增 skill 目录，只删除本 PR 新增的具体目录，例如：

   ```bash
   ssh ali-ai 'rm -rf /data/openclaw/skills/wecom-send-template-card'
   ```

4. **重启并验证**

   ```bash
   ssh ali-ai 'openclaw gateway restart'
   ssh ali-ai 'openclaw skills info wecom-msg'
   ssh ali-ai 'openclaw skills info wecom-preflight'
   ```

---

## PR-1：基线追平（低风险，约 1-2 天）

**目标**：把依赖、upstream 快照、skills 和 README 从官方快照 v1.0.13（2026-03-18）追到官方 latest 2026.4.23。当前实现已随 MCP interceptor pipeline 一起升级 `wecom/mcp-tool.js` 的 MCP 协商版本号。

### 1.1 SDK 版本升级

**文件**：`package.json:62`

```diff
- "@wecom/aibot-node-sdk": "^1.0.3",
+ "@wecom/aibot-node-sdk": "^1.0.6",
```

**验证重点**：SDK 1.0.4 起重构了 reconnect 错误类型；现有 `ws-monitor.js` 重连分支可能抛到 `WSAuthFailureError` 而不是 generic Error。先跑 `npm test`，如有失败在 PR-1 直接修；重连行为精细对齐放到 PR-2。

### 1.2 MCP 协商版本升级

**文件**：`wecom/mcp-tool.js:11`

```js
const OFFICIAL_WECOM_PLUGIN_VERSION = "2026.4.23";
```

**说明**：这个字符串随 `biz_type` 发给 WeCom MCP 后端，后端按此版本号灰度能力（document reading、smartpage 等）。本地已经先补齐 doc auth、SmartPage、media 和缓存清理拦截逻辑，再升级到官方 `2026.4.23`。

### 1.3 upstream/ 快照刷新

```bash
cd upstream
npm pack @wecom/wecom-openclaw-plugin@2026.4.23
# 解压替换 wecom-openclaw-plugin-1.0.13/ → wecom-openclaw-plugin-2026.4.23/
```

提交 `package.json`、`README.md`、`skills/`（dist 二进制和 ts 源码按需 `.gitignore`）。

### 1.4 Thinking 占位延迟到 onReplyStart

**背景**：官方 2026-03-25 commit `6531b7d` 改为在 `onReplyStart` 回调里才发 thinking 占位，避免 stream 还没就绪就占位。

**文件**：`wecom/ws-monitor.js` reply pipeline 初始化段

定位命令：

```bash
rg -n "sendThinkingReply|thinking_sent|waitingModelActive|<think></think>" wecom/ws-monitor.js
```

当前主要位置：`wecom/ws-monitor.js:1634` 附近的 `sendThinkingReply({ text: buildWaitingModelContent(...) })`。将这段延迟到 `onReplyStart`（stream 第一帧到达时）之后再发送。

### 1.5 Skill 同步

**新增**（复制官方 2026.4.23）：

- `skills/wecom-send-template-card/` — 模板卡片 skill（PR-3 能力的文档前置）

目录来源：完成 1.3 的 `npm pack` 解包后，从刷新后的 upstream 快照复制 `skills/wecom-send-template-card/`。如果解包目录带 `package/` 包裹，先规范化为 `upstream/wecom-openclaw-plugin-2026.4.23/`，再执行：

```bash
cp -a upstream/wecom-openclaw-plugin-2026.4.23/skills/wecom-send-template-card skills/
```

**更新已有 skill**：

- `skills/wecom-doc-manager/` — 补 SmartPage API 引用文档（`api-smartpage-create.md`、`api-smartpage-export-task.md`、`api-smartpage-get-export-result.md`）
- `skills/wecom-msg/`、`skills/wecom-schedule/`、`skills/wecom-meeting-*/`、`skills/wecom-smartsheet-*/` — 按官方 diff 更新描述

> 注：官方 2026.4.23 中无独立 `wecom-doc/` skill 目录；文档读取能力通过 `wecom-doc-manager` + MCP interceptor 实现（见 PR-3.4）。

**同步到服务器**（按 AGENTS.md `# 插件同步`）：

```bash
rsync -av --chown=root:root ./skills/ ali-ai:/data/openclaw/skills/
```

### 1.6 README 差异表重写

**文件**：`README.md:18-49`

把当前"官方 ❌ / 本插件 ✅"格式改为三列，清晰区分现状：

| 特性 | 官方状态 | 本插件状态 |
| --- | --- | --- |
| WebSocket 长连接 + 流式回复 | ✅ | ✅ 对齐官方实现 |
| 多账号管理 | ✅（2026.4.7 追平）| ✅ 额外增强：`adminBypass`、`bindings` 路由 |
| 动态 Agent 路由 | ✅（2026.4.7 追平）| ✅ 额外增强：`workspaceTemplate`、`adminBypass` |
| Agent/Webhook 增强出站 | ✅（2026.4.7 追平）| ✅ 保持等价 |
| 模板卡片（Template Card） | ✅（2026.4.7 新增）| 官方已支持，本插件计划 v3.3.0 对齐 |
| SmartPage | ✅（2026.4.7 新增）| 官方已支持，本插件计划 v3.3.0 对齐 |
| 配额感知 / runtime-telemetry | ❌ | ✅ **本插件独有** |
| Pending Reply 重试 | ❌ | ✅ **本插件独有** |
| Workspace 模板 | ❌ | ✅ **本插件独有** |
| 指令白名单 + 管理员绕过 | ❌ | ✅ **本插件独有** |

---

## PR-2：可靠性对齐（中风险，约 2-3 天）

**目标**：对齐官方 2026-03-25 ~ 2026-04-08 的稳定性改动，在本仓库现有机制上叠加官方兜底策略。

### 2.1 Stream 846608 反应式 fallback

**现状**：本仓库用 proactive 5 分钟旋转（`wecom/constants.js:31 STREAM_MAX_LIFETIME_MS` + `wecom/ws-monitor.js:1543 rotateStream`），但没有 errcode 识别。

**新增逻辑**（官方 commit `6531b7d`）：在 `ws-monitor.js` 的 `replyStream` 调用处捕获错误码，识别 `846608` 后 fallback 到 `sendMessage`，两者并存：

```
proactive rotation（5 min）→ 预防 stream 过期
errcode 846608 fallback      → 兜底异常 stream
```

**新增测试**：`tests/ws-monitor.stream-expiry.test.js` — mock `replyStream` 返回 `846608`，断言走 fallback path。

### 2.2 SDK 重连错误体系迁移

**背景**：SDK 1.0.4 引入 `WSAuthFailureError`（botId/secret 错误，不可重连）和 connection-drop（网络断开，可重连），代替 generic Error。

**文件**：`wecom/ws-monitor.js` 重连逻辑

```js
import { WSAuthFailureError } from "@wecom/aibot-node-sdk";
// WSAuthFailureError（botId/secret 无效）→ 停止重连，设置账号状态为 error，
//   不调用 markAccountDisplaced()（displaced 专用于被其他实例抢占的 disconnected_event）
// connection drop（网络中断）→ 继续现有退避重连
```

**保留**：`markAccountDisplaced` 语义不变（仅由 `disconnected_event` 触发）、telemetry/quota 账号级记账不变。

### 2.3 wsOptions 对齐

SDK 1.0.4 支持 `wsOptions`/WSClient 连接选项（心跳、超时、重连等），替换 `ws-monitor.js` 中分散硬编码的 ws 行为参数。实施前以 SDK 1.0.6 的实际类型/README 为准，至少覆盖以下当前已存在或官方默认支持的项：

| 参数 | 当前来源 | 迁移要求 |
| --- | --- | --- |
| `heartbeatInterval` | `wecom/constants.js:16 WS_HEARTBEAT_INTERVAL_MS = 30_000`，`wecom/ws-monitor.js:1953` | 保持当前默认 30s，但从统一 `wsOptions` 注入 |
| `maxReconnectAttempts` | `wecom/constants.js:17 WS_MAX_RECONNECT_ATTEMPTS = 100`，`wecom/ws-monitor.js:1954` | 保持本仓库 100 次语义，不回退到 SDK 默认 10 次 |
| `reconnectInterval` | 当前未显式设置，SDK 默认约 1000ms 指数退避 | 显式写入统一配置，便于后续调参和测试 |
| `requestTimeout` | 当前未传给 `WSClient`；本仓库另有 `REPLY_SEND_TIMEOUT_MS`、`MESSAGE_PROCESS_TIMEOUT_MS` | 只作为 SDK 内部请求超时传入，不替代消息处理总超时 |
| `wsUrl` | `account.websocketUrl` | 继续从账号配置透传 |

不纳入本项：媒体下载超时、Agent/MCP HTTP 超时、`STREAM_MAX_LIFETIME_MS`，这些属于业务层而不是 WSClient 连接选项。

### 2.4 WS 入站 video 类型

**背景**：SDK 1.0.4 新增 `VideoMessage` 类型（GitHub commit `b0a632d`）。

**文件**：`wecom/ws-monitor.js` 入站消息分发

```
新增：video 类型 → 走与 file 相同的下载/转发逻辑
```

更新 `README.md` 入站类型表。

---

## PR-3：新能力移植（高价值，约 5-7 天）

**目标**：移植官方 2026-04-07/22 的 Template Card、SmartPage、MCP interceptor 体系，并在 interceptor pipeline 可用后升级 MCP 协商版本。

**前置**：必须先 `npm pack @wecom/wecom-openclaw-plugin@2026.4.23` 拿到完整 dist，精读源码再开始移植——不能只靠 commit metadata。

### 3.0 MCP 协商版本升级闸门

**文件**：`wecom/mcp-tool.js`

PR-3 的实现顺序已按以下闸门完成：

1. 先完成 interceptor pipeline 与本地测试。
2. pipeline 默认策略必须是 **unknown response passthrough**：未匹配 interceptor 的 request/response 原样返回，不因为新增字段或未知结构报错。
3. 通过本地 `npm test` 和 `node --test tests/mcp-tool.test.js` 后，把协商版本升级到固定官方版本：

   ```diff
   - const PLUGIN_VERSION = "1.0.12";
   + const OFFICIAL_WECOM_PLUGIN_VERSION = "2026.4.23";
   ```

   同步把 `fetchMcpConfig()` 中的 `plugin_version` 使用处改为 `OFFICIAL_WECOM_PLUGIN_VERSION`。

4. 升级版本后在 ali-ai 上完成同步、重启和 gateway/skills 验证。

### 3.1 Template Card 解析器

**新文件**：`wecom/template-card-parser.js`（对应官方 `src/template-card-parser.ts` 731 行）

核心：只在 **最终回复文本** 中扫描候选代码块，不扫描 tool-use 参数、中间 thinking frame、日志文本或 callback 原始事件。候选块兼容官方格式：` ```json ` 或无语言标识的代码块中出现 template card JSON，不要求 ` ```wecom-card `。

````
```json
{"card_type": "text_notice", ...}
```
````

不能只用“包含 `card_type` 字段”作为命中条件。每个候选 JSON 必须同时满足：

1. 根节点是对象，不是数组或字符串。
2. `card_type` 是已支持的卡片类型。
3. 按 `card_type` 执行官方字段级校验，缺少必需字段时视为普通文本。
4. 可选兼容 `{ "template_card": { ... } }` 外层结构；如存在外层，则只校验 `template_card` 内部对象。

解析为 WeCom `template_card` payload。支持卡片类型：

| 类型 | 说明 |
| --- | --- |
| `text_notice` | 文字通知 |
| `news_notice` | 图文通知 |
| `vote_interaction` | 投票 |
| `button_interaction` | 按钮交互 |
| `multiple_interaction` | 多项交互（官方支持，需一并实现）|

**新增测试**：`tests/template-card-parser.test.js`

- 正常最终回复中的有效卡片 JSON 会被解析。
- final reply 中的无效 `card_type` 示例保持原文。
- 模拟 tool-use JSON 参数里含 `card_type` 时不会触发卡片发送。

### 3.2 Template Card 发送管理器

**新文件**：`wecom/template-card-manager.js`（对应官方 `src/template-card-manager.ts` 295 行）

挂载点：

- `wecom/ws-monitor.js` reply pipeline 末尾（检测 final reply 是否含卡片，通过 `wsClient.sendMessage` 发送——官方实现路径）
- parser 未返回有效卡片时，final reply 必须按原文本发送，不能吞掉用户可见内容。

> **注**：官方 `template-card-manager` 通过 `wsClient.sendMessage` 发送卡片，Agent API（`wecom/agent-api.js`）目前无 `template_card` 支持。如需通过 Agent API 发卡片，需额外验证 WeCom API 是否支持，作为独立增强处理，不在本 PR 范围内。

### 3.3 template_card_event 交互事件升级

**文件**：`wecom/ws-monitor.js:2060`

当前：只打日志。目标：按钮点击/投票结果回填到 Agent 的下一轮输入（作为用户侧事件透传）。

### 3.4 MCP Interceptor 架构

**新目录**：`wecom/mcp/interceptors/`

| 文件 | 来源 | 职责 |
| --- | --- | --- |
| `biz-error.js` | `src/mcp/interceptors/biz-error.ts`（72 行）| 业务错误码改写为用户可读文本 |
| `msg-media.js` | `src/mcp/interceptors/msg-media.ts`（162 行）| 消息媒体 MCP 拦截 |
| `smartpage-create.js` | `src/mcp/interceptors/smartpage-create.ts`（173 行）| SmartPage 创建 |
| `smartpage-export.js` | `src/mcp/interceptors/smartpage-export.ts`（107 行）| SmartPage 异步导出 |
| `doc-auth-error.js` | `src/mcp/interceptors/doc-auth-error.ts`（225 行，2026-04-22 新增）| 文档权限错误处理 |
| `index.js` | `src/mcp/interceptors/index.ts` | 统一导出 |

重构 `wecom/mcp-tool.js` 的 raw RPC 调用，包进 interceptor pipeline。

**责任链顺序**：

| 顺序 | interceptor | 触发点 | 失败策略 |
| --- | --- | --- | --- |
| 1 | `msg-media` | request/response | 仅匹配 `msg` 媒体方法；匹配后失败则短路为结构化错误 |
| 2 | `smartpage-create` | request/response | 仅匹配 SmartPage 创建；匹配后失败则短路 |
| 3 | `smartpage-export` | request/response | 仅匹配 SmartPage 导出/查询；匹配后失败则短路 |
| 4 | `doc-auth-error` | response | 文档权限错误优先改写，避免被通用业务错误吞掉 |
| 5 | `biz-error` | response | 最后一层通用业务错误改写 |

**数据流伪代码**：

```js
const interceptors = [
  msgMediaInterceptor,
  smartpageCreateInterceptor,
  smartpageExportInterceptor,
  docAuthErrorInterceptor,
  bizErrorInterceptor,
];

async function callMcpWithInterceptors(ctx) {
  // ctx: { accountId, category, method, params, request, response }
  for (const interceptor of interceptors) {
    if (interceptor.matches?.(ctx) === false) continue;
    const next = await interceptor.beforeRequest?.(ctx);
    if (next?.handled) return next.result;
    if (next?.request) ctx.request = next.request;
  }

  ctx.response = await sendRawJsonRpc(ctx.url, ctx.session, ctx.request);

  for (const interceptor of [...interceptors].reverse()) {
    if (interceptor.matches?.(ctx) === false) continue;
    const next = await interceptor.afterResponse?.(ctx);
    if (next?.handled) return next.result;
    if (next?.response) ctx.response = next.response;
  }

  return ctx.response; // unknown response passthrough
}
```

约束：

- raw RPC 只调用一次；interceptor 只能改写 `ctx.request` / `ctx.response` 或显式 `handled` 短路。
- 不匹配的 interceptor 必须无副作用跳过。
- 已匹配 interceptor 抛错时不继续后续链路，返回带 `category`、`method`、`interceptor` 的结构化错误，便于定位。
- 未知字段和未知 response shape 默认透传，这是 `PLUGIN_VERSION` 升级的安全前提。

---

## PR-4：性能优化（可延后，约 2-3 天）

### 4.1 callback-crypto 内部替换为 SDK wecom-crypto

**文件**：`wecom/callback-crypto.js`

保留 facade 接口（不动 `wecom/callback-inbound.js` 调用方），内部换用 SDK 1.0.6 的 `WecomCrypto` 类。

**策略**：不做运行时影子模式。先用固定测试向量写 byte-level 兼容测试，对比旧实现与 SDK `WecomCrypto` 的签名校验、AES 解密、JSON/XML payload 解析结果；测试全过后直接切换 facade 内部实现。

**新增测试**：`tests/callback-crypto.sdk-compat.test.js`

### 4.2 Thinking Stream → replyStreamNonBlocking

**文件**：`wecom/ws-monitor.js`

把 thinking 中间帧改为 SDK 1.0.5 的 `replyStreamNonBlocking`，相应放宽 `MAX_INTERMEDIATE_STREAM_MESSAGES=85`。监控 24h reply quota 是否受影响。

---

## 明确不迁移的项

| 项 | 原因 |
| --- | --- |
| 官方 WSClient 全局共享（commit `d0ed128`）| 本仓库 `markAccountDisplaced`、pending reply 队列、24h quota 均按"每账号一连接"建模，共享会破坏账号级隔离 |
| 官方 dynamic-routing.ts 实现 | 功能等价，本仓库还有 `adminBypass`/`bindings`/`workspaceTemplate` 增强逻辑，整体替换成本高无收益 |

---

## 验证矩阵

每个 PR 合并前必须通过：

| 检查项 | 命令 |
| --- | --- |
| 单元测试全过 | `npm test` |
| 本地单文件 E2E | `node --test tests/ws.e2e.test.js` |
| MCP 接口 dry run（PR-3 或 MCP 改动时） | `node scripts/wecom-mcp-remote-call.js --category doc --method get_doc_base_info --args '{"docid":"<id>"}'` |
| ali-ai 同步 | 按 AGENTS.md rsync 命令 |
| Gateway 重启验证 | `ssh ali-ai 'openclaw gateway restart'` |

### PR-1 特别验证项

- 确认 `wecom/mcp-tool.js` 的 `OFFICIAL_WECOM_PLUGIN_VERSION` 为 `"2026.4.23"`，且 interceptor pipeline 已启用
- SDK 升级后 `disconnected_event` / reconnect 行为不回归（ws.e2e.test.js）

### PR-2 特别验证项

- mock errcode `846608` 注入测试（`tests/ws-monitor.stream-expiry.test.js`）
- ali-ai takeover / reconnect 场景实测（终止一个实例，观察另一个实例接管行为）

### PR-3 特别验证项

- `PLUGIN_VERSION` 升级后，`wecom_mcp` 对 doc/smartpage 接口的调用是否正常返回（ali-ai dry run）
- Template Card：ali-ai 上让 Agent 输出有效 template card JSON 代码块，验证卡片发出；再输出含 `card_type` 的普通 tool 参数示例，验证不会误发卡片
- SmartPage：调用 `wecom-doc-manager` skill 创建页面，验证异步导出流程
- button_interaction：点击卡片按钮，验证事件回填到 Agent 输入

### PR-4 特别验证项

- `callback-crypto.js` 替换：固定测试向量下旧实现与 SDK `WecomCrypto` byte-level 比对通过
- `replyStreamNonBlocking`：ali-ai 上发长文本，观察 thinking stream 流畅度和 quota 消耗
