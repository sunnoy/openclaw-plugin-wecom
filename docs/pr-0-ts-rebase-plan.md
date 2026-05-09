# PR-0：基于官方源码重构方案

> 基准：官方 `@wecom/wecom-openclaw-plugin@2026.4.23`
> 分支：`refactor/ts-rebase`（从 `main` 切出，不影响主分支）
> 目标版本：`v4.0.0`（major bump，反映底层重构）
> 预计工期：1 周

## 为什么要做这个

官方插件 2026-04-07（commit `2bf87b0`）吸收了本仓库 fork 的 Agent/Webhook 双模、多账号、动态 Agent 思路（commit message 明确致谢 `TencentCloud-Lighthouse/openclaw-wecom`），并新增了 Template Card、SmartPage、MCP interceptor、document reading 等本仓库尚未实现的能力。

**继续维护平行 JS 实现的代价**：
- 每次官方升级都要从 commit metadata 反推改动，移植成本高
- 官方修了 bug，本仓库要再修一次
- 官方加新能力（Template Card 731 行、SmartPage 280 行）要重新实现一次

**重构成 fork 官方 TS 源码后**：
- `git diff src/old-version src/new-version` 一目了然
- 本仓库增量用 `// @sunnoy: BEGIN/END` 注释标记，patch 升级有清晰落点
- 官方所有新能力（Template Card、SmartPage、document reading）**自动获得**

## 重构原则

1. **基底 = 官方源码原样 fork**：不重写官方实现，只在必要处 patch
2. **增量 = 独立 TS 文件**：本仓库独有特性写成新的 `.ts`，不混入官方文件
3. **patch 必须可识别**：所有官方文件改动用 `// @sunnoy: BEGIN <feature>` / `// @sunnoy: END` 块标记
4. **舍弃自实现**：官方/SDK 已有等价能力的，全部切换（callback-crypto、bindings、allowFrom、mediaLocalRoots）

## 目录结构

```
openclaw-plugin-wecom/
├── src/                              # 新增，TS 源码
│   ├── （fork 自官方 2026.4.23）
│   │   ├── accounts.ts               # patch: welcomeMessagesFile
│   │   ├── channel.ts
│   │   ├── chat-queue.ts
│   │   ├── const.ts
│   │   ├── dm-policy.ts              # 不改
│   │   ├── dynamic-agent.ts          # patch: adminBypass + workspaceTemplate hook
│   │   ├── dynamic-routing.ts        # 不改
│   │   ├── group-policy.ts           # 不改
│   │   ├── http.ts
│   │   ├── interface.ts
│   │   ├── monitor.ts                # patch: pending-reply + reasoning 节流 + think-parser + sender protocol
│   │   ├── target.ts                 # patch: 中文名→拼音
│   │   ├── template-card-parser.ts   # 官方原样
│   │   ├── template-card-manager.ts  # 官方原样
│   │   ├── agent/                    # 官方原样
│   │   ├── webhook/                  # 官方原样（注：这是自建应用 webhook，不是群机器人）
│   │   ├── mcp/                      # 官方原样（含 interceptors/）
│   │   ├── shared/                   # 官方原样
│   │   ├── types/                    # 官方原样
│   │   └── index.ts                  # patch: 注册本仓库工具
│   │
│   └── @sunnoy/                      # 本仓库独有，纯增量
│       ├── runtime-telemetry.ts      # 24h reply quota + active send quota
│       ├── ws-state.ts               # pending reply 队列
│       ├── workspace-template.ts     # 动态 Agent 工作区模板
│       ├── welcome-messages-file.ts  # 外链欢迎语 + 热加载
│       ├── webhook-bot.ts            # 群机器人 webhook（官方完全没有）
│       ├── outbound-sender-protocol.ts
│       ├── think-parser.ts
│       ├── plugin-config.ts          # qwenImageTools schema
│       ├── browser-media-tool.ts     # stage_browser_media
│       ├── image-studio-tool.ts      # 通义/万相生图
│       ├── parent-resolver.ts
│       └── sandbox.ts
│
├── dist/                             # 构建产物，含 index.cjs.js + index.esm.js + index.d.ts
├── tests/                            # 现有测试，改为测 dist/
├── upstream/                         # 留存官方源码快照（参考）
├── tsconfig.json                     # 新增（拷贝官方 + 调整路径）
├── rollup.config.mjs                 # 新增（拷贝官方）
├── package.json                      # main 改为 dist/index.cjs.js
└── ...
```

## 工作流程：新分支策略

```bash
# 主分支保持稳定，不动
git checkout main
git pull

# 切重构分支
git checkout -b refactor/ts-rebase

# 整个 PR-0 在这个分支上完成
# 期间 main 上如有 hotfix，cherry-pick 过来
```

合并时机：PR-0 全部完成 + ali-ai 灰度 3 天无回归后，整体 squash merge 到 main。

---

## Phase 0.1：基础设施（半天）

### 0.1.1 拉官方 TS 源码

npm tarball 只有 dist/，TS 源码要从 GitHub 拉：

```bash
# 在 /tmp 准备
cd /tmp
git clone https://github.com/WecomTeam/wecom-openclaw-plugin.git wecom-upstream
cd wecom-upstream
git checkout v2026.4.23   # 或对应 commit 6f3ed44
ls src/                    # 确认是 .ts 源码
```

### 0.1.2 fork 到本仓库

```bash
cd /home/lr/Downloads/open-code/openclaw-plugin-wecom
git checkout -b refactor/ts-rebase
mkdir -p src
cp -r /tmp/wecom-upstream/src/* src/
cp /tmp/wecom-upstream/tsconfig.json .
cp /tmp/wecom-upstream/rollup.config.mjs .   # 或 rollup.config.js
mkdir -p src/@sunnoy
```

### 0.1.3 调整 package.json

保留：`name: "@sunnoy/wecom"`、`version: "4.0.0-alpha.1"`、`author`、`license: "ISC"`、`dependencies` 中本仓库独有的（`pinyin-pro`、`file-type`）

对齐官方：`main: "dist/index.cjs.js"`、`module: "dist/index.esm.js"`、`types: "dist/index.d.ts"`、`files: ["dist", "skills", ...]`、`scripts.build: "rollup -c"`

新增 devDependencies：`typescript`、`rollup`、`@rollup/plugin-typescript`、`tslib`、`@types/node`

### 0.1.4 验证构建管道

```bash
npm install
npm run build
node -e "import('./dist/index.esm.js').then(m => console.log(Object.keys(m)))"
```

期望：build 无 TS 错误，dist 产物完整，import 不报错。

**当前阶段官方源码完全原样**，先确保构建链路通了。

---

## Phase 0.2：移植本仓库独有模块到 `src/@sunnoy/`（3 天）

按依赖顺序分三波。每移植一个模块：
1. 写 TS 版本到 `src/@sunnoy/<name>.ts`
2. 加 TS 类型（从 JSDoc 推断或读官方 types/）
3. 跑对应的 `tests/<name>.test.js`（先 `npm run build` 再测 dist）
4. 测试全过才进入下一个

### 第一波：叶子模块（无内部依赖）

| 模块 | 行数 | 源 |
|---|---:|---|
| `src/@sunnoy/think-parser.ts` | 159 | `think-parser.js`（根目录） |
| `src/@sunnoy/welcome-messages-file.ts` | 155 | `wecom/welcome-messages-file.js` |
| `src/@sunnoy/outbound-sender-protocol.ts` | 142 | `wecom/outbound-sender-protocol.js` |

### 第二波：中间层（依赖第一波或官方 types）

| 模块 | 行数 | 源 |
|---|---:|---|
| `src/@sunnoy/runtime-telemetry.ts` | 330 | `wecom/runtime-telemetry.js` |
| `src/@sunnoy/ws-state.ts` | 160 | `wecom/ws-state.js`（pending reply 队列） |
| `src/@sunnoy/workspace-template.ts` | 397 | `wecom/workspace-template.js` |

### 第三波：叶子工具（不被其他模块 import）

| 模块 | 行数 | 源 |
|---|---:|---|
| `src/@sunnoy/webhook-bot.ts` | 155 | `wecom/webhook-bot.js`（群机器人 qyapi webhook） |
| `src/@sunnoy/plugin-config.ts` | 484 | `wecom/plugin-config.js`（qwenImageTools schema） |
| `src/@sunnoy/browser-media-tool.ts` | 191 | `wecom/browser-media-tool.js` |
| `src/@sunnoy/image-studio-tool.ts` | 764 | `wecom/image-studio-tool.js` |
| `src/@sunnoy/parent-resolver.ts` | 26 | `wecom/parent-resolver.js`（确认后保留） |
| `src/@sunnoy/sandbox.ts` | 60 | `wecom/sandbox.js` |

合计约 **3000 行新增 TS**。

---

## Phase 0.3：patch 官方文件（2 天）

每处 patch 必须用注释块包围，便于未来 diff：

```ts
// @sunnoy: BEGIN <feature-name>
// 增量逻辑
// @sunnoy: END <feature-name>
```

### 0.3.1 `src/dynamic-agent.ts`

**问题**：官方第 42 行硬编码"管理员始终绕过动态路由，使用主 Agent"，但本仓库要 boolean 开关。

**patch**：

```ts
// 官方原代码：const isAdmin = dynamicConfig.adminUsers.some(...)
// 改为：
// @sunnoy: BEGIN admin-bypass-toggle
const adminBypassEnabled = dynamicConfig.adminBypass !== false; // 默认 true 与官方对齐
const isAdmin = adminBypassEnabled
  && dynamicConfig.adminUsers.some(admin => admin.trim().toLowerCase() === sender);
// @sunnoy: END admin-bypass-toggle
```

**新增 hook**：动态 Agent 首次创建时调用 `workspace-template.ts`：

```ts
// @sunnoy: BEGIN workspace-template-hook
import { applyWorkspaceTemplate } from "./@sunnoy/workspace-template.js";
// 在 createDynamicAgent() 末尾：
await applyWorkspaceTemplate({ agentId, workspaceTemplate: cfg.workspaceTemplate });
// @sunnoy: END workspace-template-hook
```

### 0.3.2 `src/monitor.ts`（最大的 patch）

**集成点**：
- pending reply 队列：WS 断连后通过 Agent API 补发
- reasoning stream 800ms 节流（保留本仓库 `MAX_INTERMEDIATE_STREAM_MESSAGES=85`）
- think-parser：标准化 `<thinking>`/`<thought>` 为 `<think>`
- outbound sender protocol：注入 `[[sender:...]]`
- proactive 5 分钟 stream rotation：与官方 reactive 846608 fallback 双策略

每处独立标记 `// @sunnoy: BEGIN <name>`，便于将来逐项删除或保留。

### 0.3.3 `src/target.ts`

加中文名→拼音 userId 解析：

```ts
// @sunnoy: BEGIN chinese-name-resolver
import { pinyin } from "pinyin-pro";
// 在 resolveWecomTarget() 中：识别纯中文名 → 转拼音 → 匹配 ~/.openclaw/agents 下已存在的动态 DM Agent
// @sunnoy: END chinese-name-resolver
```

### 0.3.4 `src/accounts.ts`

加 `welcomeMessagesFile` 字段处理：

```ts
// @sunnoy: BEGIN welcome-messages-file
import { resolveWelcomeMessage } from "./@sunnoy/welcome-messages-file.js";
// 在欢迎语解析处：welcomeMessage 优先，否则走 welcomeMessagesFile
// @sunnoy: END welcome-messages-file
```

### 0.3.5 `src/index.ts`

注册本仓库工具：

```ts
// @sunnoy: BEGIN extra-tools
import { registerImageStudioTool } from "./@sunnoy/image-studio-tool.js";
import { registerBrowserMediaTool } from "./@sunnoy/browser-media-tool.js";
import { wecomPluginConfigSchema } from "./@sunnoy/plugin-config.js";
// 在 register() 中：
registerImageStudioTool(api);
registerBrowserMediaTool(api);
// 配置 schema 合并 wecomPluginConfigSchema
// @sunnoy: END extra-tools
```

---

## Phase 0.4：替换/清理（1 天）

### 0.4.1 callback-crypto 切到 SDK

```bash
rm wecom/callback-crypto.js   # 等所有引用迁完再删
```

调用方（`src/agent/handler.ts`、`src/webhook/handler.ts`）改为：
```ts
import { WecomCrypto } from "@wecom/aibot-node-sdk";
```

### 0.4.2 commands 适配层

本仓库的简单 allowlist 与官方 access-groups 体系不互通。决策：

```ts
// src/@sunnoy/commands-adapter.ts
// 当 commands.useAccessGroups === false 时走本仓库 allowlist
// 否则走官方 access-groups
```

### 0.4.3 老 `wecom/` 目录处理

- 已迁移文件：删除 `wecom/<name>.js`
- 未迁移工具脚本（`scripts/*.js`）：保留
- 入口 `index.js`（根目录）：删除，由 `src/index.ts` 替代
- `dynamic-agent.js`（根目录）、`utils.js`（根目录）、`logger.js`（根目录）：迁到 `src/` 后删除根目录原文件

---

## Phase 0.5：收尾验证 + 发版（1 天）

### 0.5.1 测试矩阵

| 项 | 命令 | 必须 |
|---|---|:---:|
| 单元测试全过 | `npm test` | ✅ |
| build 干净 | `npm run build` 无 warning | ✅ |
| TS 类型检查 | `npx tsc --noEmit` | ✅ |
| WS E2E | `node --test tests/ws.e2e.test.js` | ✅ |
| import 验证 | `node -e "import('./dist/index.esm.js')"` | ✅ |

### 0.5.2 ali-ai 部署验证

```bash
# 同步插件代码（含 dist/，注意 src/ 不需要同步到生产）
rsync -av --delete --chown=root:root \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude "src/" \
  --exclude "upstream/" \
  --exclude "skills/" \
  --exclude "tests/" \
  ./ ali-ai:/root/.openclaw/extensions/wecom/

# 同步新 skill（含官方的 wecom-send-template-card）
rsync -av --chown=root:root \
  ./skills/ ali-ai:/data/openclaw/skills/

# 重启
ssh ali-ai 'openclaw gateway restart'
ssh ali-ai 'openclaw skills info wecom-send-template-card'
```

### 0.5.3 真实场景灰度（3 天）

- 私聊文本回复
- 群聊 @ 回复
- 浏览器图片回复（`stage_browser_media`）
- 主动消息（`message.send` + sender protocol）
- WS 断连后 pending reply 补发
- 模板卡片（官方新能力，自动可用）

3 天无回归 → 合并到 main → 发版 v4.0.0。

### 0.5.4 文档

| 文档 | 改动 |
|---|---|
| `AGENTS.md` | 删除"无 build step"，加 `npm run build` 流程 |
| `README.md` | 差异表重写为"基于官方 fork + 增量"风格；列出本仓库独有能力 |
| `CONTRIBUTING.md` | TS 开发流程、`@sunnoy` 标记规范 |
| `CHANGELOG.md` | v4.0.0：底层重构 + 官方 2026.4.23 对齐 + 自动获得 Template Card / SmartPage / document reading |
| `docs/architecture.md` | 新增：fork 策略、`// @sunnoy:` 标记规范、未来升级流程 |

### 0.5.5 PR-1/2/3/4 重新评估

| 原 PR | 状态 |
|---|---|
| PR-1（SDK 升级 + skill 同步 + README 修订） | **随 PR-0 完成** |
| PR-2（stream fallback + SDK 重连错误体系 + video 入站） | **随 PR-0 完成**（官方源码已含） |
| PR-3（Template Card + SmartPage + MCP interceptors） | **随 PR-0 完成**（官方源码已含） |
| PR-4（crypto 替换 + replyStreamNonBlocking） | crypto 在 PR-0.4 完成；nonBlocking 单独评估 |

PR-0 一次性把原计划 PR-1/2/3 全部覆盖。

---

## 风险与回退

| 风险 | 概率 | 缓解 |
|---|:---:|---|
| 官方源码与本仓库 sandbox/runtime API 不兼容 | 中 | Phase 0.1 验证构建管道时同时验证基础 import |
| TS 类型错误集中爆发 | 中 | 每移植一个模块就 `tsc --noEmit`，避免堆积 |
| ali-ai 沙箱镜像缺 TS 工具链 | 低 | 部署只发 dist/，本地构建 |
| 测试现在测 JS，重构后要测 dist | 中 | Phase 0.1 末尾就跑通最简单的测试，确认路径 |
| 官方 commit 跟 npm 2026.4.23 内容不匹配 | 低 | 用 GitHub tag `v2026.4.23` 而非 main |

**回退策略**：分支独立。任何阶段失败都不影响 main，可随时 `git checkout main` 回到 v3.0.1 稳定状态。

## 实施顺序

```
Phase 0.1 (半天)  → 0.2 (3天)  → 0.3 (2天)  → 0.4 (1天)  → 0.5 (1天 + 灰度3天)
   基础设施         移植独有       patch官方     替换清理     收尾验证
```

合计：**1 周开发 + 3 天灰度 = 10 天**到发版 v4.0.0。
