# 官方插件 1.0.10 特性迁移计划

> 基线：`@wecom/wecom-openclaw-plugin@1.0.10` vs `@sunnoy/wecom@2.1.0`（基于官方 1.0.5 增强）
>
> 日期：2026-03-14

---

## 迁移总览

官方 1.0.5 → 1.0.10 新增约 1000 行代码，涉及 4 个新模块 + 1 个 Skill。
本插件已独立实现了其中大部分能力，以下按"已对齐 / 需迁移 / 不迁移"分类。

### 已对齐（无需迁移）

| 官方特性 | 本插件对应 | 备注 |
|----------|-----------|------|
| Message State TTL 清理 | `ws-state.js` `pruneMessageStates()` | TTL 10min / MAX 500 / 60s 清理间隔，常量已对齐 |
| openclaw-compat SDK 兼容层 | `openclaw-compat.js` | 本插件更完善：sandbox: 前缀、runtimeLoadMedia、LocalMediaAccessError fallback |
| MCP 配置拉取 + 原子写入 | `mcp-config.js` | 写入队列串行化、withTimeout 15s、atomic rename |
| MEDIA:/FILE: 指令 + before_prompt_build | `index.js:34` + `ws-monitor.js:400` | 本插件额外区分了 IMAGE vs FILE 语义 |
| MIME 字典 + buffer 嗅探 | `openclaw-compat.js` MIME_BY_EXT | 30+ 扩展名已对齐 |
| 群组内发送人白名单 | `group-policy.js` `resolveGroupConfig()` | 支持 `groups.<chatId>.allowFrom` |
| Pending replies 队列 | `ws-state.js` `enqueuePendingReply()` | 官方没有此能力（本插件独有） |
| 超时常量 | `constants.js` | IMAGE 30s / FILE 60s / REPLY 15s / PROCESS 5min 已对齐 |

### 需迁移（4 项）

| # | 特性 | 优先级 | 新文件 | 修改文件 |
|---|------|--------|--------|----------|
| M1 | 出站媒体上传 + 类型降级 | P0 | `wecom/media-uploader.js` | `channel-plugin.js`, `ws-monitor.js` |
| M2 | Gateway deliveryMode + deliver 回调 | P1 | — | `channel-plugin.js`, `ws-monitor.js` |
| M3 | ReqId 磁盘持久化 | P2 | `wecom/reqid-store.js` | `ws-monitor.js`, `constants.js` |
| M4 | wecom-doc Skill | P1 | `skills/wecom-doc/` | `openclaw.plugin.json` |

---

## M1: 出站媒体上传 + 类型降级

### 背景

官方 1.0.10 新增 `media-uploader.ts`，通过 WSClient 分片上传媒体并自动降级超限文件。
本插件 `channel-plugin.js` 的 `sendMedia` 目前仅走 Agent API 上传或发送 WS 通知，
缺少通过 WS 长连接直接上传 + 类型降级能力。

### 迁移内容

#### 1.1 新建 `wecom/media-uploader.js`

从官方提取以下函数，适配本插件的 `loadOutboundMediaFromUrl`：

```javascript
// MIME → 企微媒体类型映射
export function detectWeComMediaType(mimeType) {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") || mime === "application/ogg") return "voice";
  return "file";
}

// 文件大小检查 + 降级策略
export function applyFileSizeLimits(fileSize, detectedType, contentType) { ... }

// 从 URL/路径中提取文件名
export function extractFileName(mediaUrl, providedFileName, contentType) { ... }

// MIME → 扩展名
export function mimeToExtension(mime) { ... }

// 加载媒体文件（调用 openclaw-compat.loadOutboundMediaFromUrl）
export async function resolveMediaFile(mediaUrl, mediaLocalRoots) { ... }

// 统一上传+发送入口
export async function uploadAndSendMedia({ wsClient, mediaUrl, chatId, mediaLocalRoots, log, errorLog }) { ... }
```

#### 1.2 常量补充到 `constants.js`

```javascript
export const IMAGE_MAX_BYTES  = 10 * 1024 * 1024;  // 10MB
export const VIDEO_MAX_BYTES  = 10 * 1024 * 1024;  // 10MB
export const VOICE_MAX_BYTES  = 2 * 1024 * 1024;   // 2MB
export const FILE_MAX_BYTES   = 20 * 1024 * 1024;   // 20MB
export const ABSOLUTE_MAX_BYTES = FILE_MAX_BYTES;
```

#### 1.3 修改 `channel-plugin.js` outbound.sendMedia

在现有三层投递路由中，增加 WS 直传路径：

```javascript
// 现有逻辑（保留）：
// 1. webhook → sendViaWebhook
// 2. toParty/toTag → sendViaAgent (必须走 Agent API)
// 3. agent credentials → sendViaAgent + WS notice

// 新增路径（在路径 2 之前）：
// 如果 wsClient 可用且非 party/tag 目标 → 优先 uploadAndSendMedia
// 失败时 fallback 到 Agent API
```

#### 1.4 修改 `ws-monitor.js` deliver 回调中的媒体处理

monitor 内部处理 LLM 返回的 MEDIA:/FILE: 指令时，
用 `uploadAndSendMedia` 替代当前的 `prepareImageBufferForMsgItem` + `replyStream(msgItem)` 路径，
统一走 `sendMediaMessage` 主动发送（避免 reqId 只能用一次的问题）。

### 降级策略对照表

| 条件 | 原始类型 | 降级为 | 提示 |
|------|---------|--------|------|
| voice 非 AMR | voice | file | "语音格式不支持，已转为文件" |
| image > 10MB | image | file | "图片超限，已转为文件" |
| video > 10MB | video | file | "视频超限，已转为文件" |
| voice > 2MB | voice | file | "语音超限，已转为文件" |
| file > 20MB | file | 拒绝 | "超过最大限制 20MB" |

### 测试要点

- `detectWeComMediaType` 各 MIME 类型映射
- `applyFileSizeLimits` 各降级场景 + 边界值
- `uploadAndSendMedia` 成功 / rejected / error 三种返回
- `channel-plugin.js` sendMedia WS 路径 + fallback

---

## M2: Gateway deliveryMode + deliver 回调

### 背景

官方使用 `deliveryMode: "gateway"` 配合 OpenClaw 核心的
`dispatchReplyWithBufferedBlockDispatcher` 管理回复生命周期。
框架通过 `deliver(payload, info)` 回调投递文本和媒体，
并保证 thinking 流在任何情况下都被正确关闭。

本插件使用 `deliveryMode: "direct"`，在 `ws-monitor.js` 中手动管理
`streamContext`、文本累积、thinking 流关闭。

### 迁移方案

#### 2.1 channel-plugin.js: deliveryMode 改为 "gateway"

```javascript
outbound: {
  deliveryMode: "gateway",  // 从 "direct" 改为 "gateway"
  // sendText / sendMedia 保持不变（三层投递路由）
}
```

#### 2.2 ws-monitor.js: 用 deliver 回调替代手动 stream 管理

核心改造点：

```javascript
// 当前方式（manual）：
//   ws-monitor.js 自己调用 runtime.channel.reply.dispatch()
//   手动 replyStream() 发送流式文本
//   手动管理 streamContext Map

// 迁移后（gateway deliver）：
await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
  ctx: ctxPayload,
  cfg: config,
  dispatcherOptions: {
    deliver: async (payload, info) => {
      state.deliverCalled = true;
      // 累积文本
      if (payload.text) accumulateText(state, payload.text);
      // 媒体走 uploadAndSendMedia (M1)
      const mediaUrls = payload.mediaUrls?.length
        ? payload.mediaUrls
        : payload.mediaUrl ? [payload.mediaUrl] : [];
      if (mediaUrls.length > 0) {
        await sendMediaBatch(ctx, mediaUrls);
      }
      // 中间帧：流式更新
      if (info.kind !== "final" && state.hasText) {
        await sendWeComReply({ wsClient, frame, text: state.accumulatedText, finish: false, streamId: state.streamId });
      }
    },
    onError: (err, info) => { ... },
  },
});
// 无论成功失败，关闭 thinking 流
await finishThinkingStream(ctx);
```

#### 2.3 新增 finishThinkingStream 函数

从官方移植，覆盖 5 种关闭场景：

```javascript
async function finishThinkingStream(ctx) {
  const { wsClient, frame, state, runtime } = ctx;
  const visibleText = stripThinkTags(state.accumulatedText);
  let finishText;
  if (visibleText)                                    finishText = state.accumulatedText;
  else if (state.hasMedia)                            finishText = "文件已发送，请查收。";
  else if (state.hasMediaFailed && state.mediaErrorSummary) finishText = state.mediaErrorSummary;
  else                                                finishText = "处理完成。";
  await sendWeComReply({ wsClient, frame, text: finishText, finish: true, streamId: state.streamId });
}
```

### 注意事项

- `dispatchReplyWithBufferedBlockDispatcher` 需要确认 OpenClaw SDK 版本是否导出此方法
- 如果 SDK 不可用，保留当前 direct 模式作为 fallback
- outbound 的 `sendText` / `sendMedia` 路由逻辑不变（三层投递是本插件核心优势）
- callback-inbound.js 不受影响（它有独立的消息处理流程）

### 测试要点

- deliver 回调：文本累积、媒体批量发送
- finishThinkingStream：5 种场景覆盖
- dispatch 异常时 thinking 流仍被关闭
- 回归：三层投递路由（webhook/agent/WS）不受影响

---

## M3: ReqId 磁盘持久化

### 背景

官方 1.0.10 新增 `reqid-store.ts`，将 chatId → streamId 映射持久化到磁盘，
启动时预热后再建立 WS 连接，确保重启后流式消息的连续性。

本插件的 streamId 完全在内存中（`streamContext` Map），重启后丢失。

### 迁移内容

#### 3.1 新建 `wecom/reqid-store.js`

```javascript
export function createPersistentReqIdStore(accountId, options = {}) {
  const maxSize  = options.maxSize  ?? REQID_MAX_SIZE;        // 200
  const ttlMs    = options.ttlMs    ?? REQID_TTL_MS;          // 7 days
  const debounce = options.debounce ?? REQID_FLUSH_DEBOUNCE_MS; // 1000ms
  const cache = new Map();  // chatId → { reqId, updatedAt }
  let dirty = false;
  let flushTimer = null;

  function filePath() {
    return path.join(os.homedir(), ".openclaw", "wecomConfig", `reqids-${accountId}.json`);
  }

  return {
    set(chatId, reqId)    { ... },  // 更新缓存 + 标记 dirty + 触发 debounce flush
    getSync(chatId)       { ... },  // 从缓存读取（检查 TTL）
    async warmup()        { ... },  // 从磁盘加载到缓存
    async flush()         { ... },  // 写入磁盘（atomic write）
    destroy()             { ... },  // 清理 timer
  };
}
```

#### 3.2 常量（已存在于 constants.js）

```javascript
export const REQID_TTL_MS           = 7 * 24 * 60 * 60 * 1000;  // 7 天
export const REQID_MAX_SIZE         = 200;
export const REQID_FLUSH_DEBOUNCE_MS = 1_000;
```

#### 3.3 修改 ws-monitor.js 启动流程

```javascript
// 当前：
wsClient.connect();

// 改为：
const reqIdStore = createPersistentReqIdStore(account.accountId);
await reqIdStore.warmup();       // 先从磁盘加载
wsClient.connect();              // 再建立连接

// 发送流式回复时：
const streamId = reqIdStore.getSync(chatId) ?? generateReqId("stream");
reqIdStore.set(chatId, streamId);

// 关闭时：
await reqIdStore.flush();
reqIdStore.destroy();
```

### 测试要点

- warmup 从磁盘加载 + TTL 过滤
- set/getSync 内存读写
- flush debounce + atomic write
- maxSize 驱逐最旧条目
- 文件不存在时 warmup 不报错

---

## M4: wecom-doc Skill

### 背景

官方 1.0.10 附带 `skills/wecom-doc/` Skill，通过 MCP + mcporter 工具调用
企业微信文档和智能表格 API。这是一个独立的能力模块，可以直接复制引入。

### 迁移内容

#### 4.1 复制 Skill 文件

```
skills/wecom-doc/
  SKILL.md               # Skill 定义 + 工作流指引
  references/
    doc-api.md            # 文档/智能表格 API 参考
```

从 `@wecom/wecom-openclaw-plugin@1.0.10` 的 `skills/wecom-doc/` 目录直接复制。

#### 4.2 Skill 功能概要

- 文档创建与编辑（doc_type: 3，Markdown 全量覆写）
- 智能表格创建（doc_type: 10）
- 子表 / 字段 / 记录的增删改查
- 16 种字段类型支持（TEXT / NUMBER / DATE_TIME / SELECT 等）
- 完整的前置检查流程（mcporter 安装 → MCP Server 配置 → botId 授权）
- 错误处理（errcode 850001 配置引导、MCP 未配置检测）

#### 4.3 Skill 元数据

```yaml
name: wecom-doc
description: >
  文档与智能表格操作。当用户提到企业微信文档、创建文档、编辑文档、新建文档、
  写文档、智能表格时激活。
metadata:
  openclaw:
    emoji: "📄"
    always: true
    requires:
      bins: ["mcporter"]
    install:
      - id: mcporter
        kind: node
        package: mcporter
        bins: ["mcporter"]
        label: "Install mcporter (npm)"
```

#### 4.4 适配修改

Skill 原文中有两处需要适配本插件的多账号架构：

1. **配置文件路径**：官方固定读 `~/.openclaw/wecomConfig/config.json`，
   本插件已在 `mcp-config.js` 中写入同一位置，无需修改

2. **botId 获取**：官方用 `openclaw config get channels.wecom.botId`，
   本插件多账号模式下需要改为读取第一个可用账号的 botId。
   可在 SKILL.md 的「步骤二」中补充多账号查询逻辑：
   ```bash
   # 单账号
   openclaw config get channels.wecom.botId 2>&1
   # 多账号（取第一个）
   openclaw config get channels.wecom 2>&1 | head -20
   ```

#### 4.5 验证 openclaw.plugin.json

当前 `openclaw.plugin.json` 已声明 `"skills": ["./skills"]`，
新增的 `skills/wecom-doc/` 目录会被自动发现，无需修改 manifest。

### 测试要点

- mcporter 安装检测流程
- MCP Server 自动配置（从 config.json 读取）
- 文档创建 + 编辑工作流
- 智能表格全流程（创建 → 子表 → 字段 → 记录）
- 错误处理（未授权、未配置）

---

## 实施顺序

```
Phase 1 (P0):  M1 出站媒体上传 + M4 wecom-doc Skill
               M1 直接影响用户发文件体验
               M4 是纯文件复制，零风险

Phase 2 (P1):  M2 Gateway deliver 回调
               需要先确认 SDK 版本兼容性
               ws-monitor.js 改动较大，需充分回归测试

Phase 3 (P2):  M3 ReqId 磁盘持久化
               改善重启体验，非关键路径
               可在 M2 完成后再实施（deliver 模式稳定后）
```

## 本插件独有能力（不受迁移影响）

以下能力是本插件相对官方的增强点，迁移过程中需确保不被破坏：

| 能力 | 涉及文件 |
|------|----------|
| 多账号管理（dictionary mode） | `accounts.js` |
| 双入站通道（WS + HTTP callback） | `ws-monitor.js`, `callback-inbound.js` |
| 三层出站投递（WS → webhook → Agent API） | `channel-plugin.js` |
| 网络代理 + API base URL 配置 | `http.js`, `constants.js` |
| 运行时遥测（配额预测、连接置换检测） | `runtime-telemetry.js` |
| 动态 Agent 路由 | `dynamic-agent.js`, `workspace-template.js` |
| 指令白名单 + 管理员覆盖 | `commands.js`, `allow-from.js` |
| 重放攻击防护（HTTP callback） | `callback-crypto.js` |
| Pending replies 队列（WS 断连恢复） | `ws-state.js` |
