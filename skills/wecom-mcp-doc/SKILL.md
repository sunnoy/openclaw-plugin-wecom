---
name: wecom-mcp-doc
description: 企业微信文档 MCP 底层操作技能。通过 curl 直接调用 WeCom 文档 MCP JSON-RPC 2.0 接口，
  不依赖 wecom_mcp tool。支持文档创建/读取/编辑、智能表格结构管理、记录增删改查、
  智能文档（Smartpage）创建/导出、图片文件上传。
  适用场景：创建企微文档/智能表格、导出文档内容、管理表格字段和记录、
  上传图片/文件到文档、批量写入智能表格数据。
  触发词：企微文档、企业微信文档、WeCom doc、智能表格、smartsheet、
  文档导出、表格写入、表格字段、create_doc、smartsheet_get_sheet、
  smartsheet_add_fields、smartsheet_add_records、upload_doc_image。
allowed-tools: Bash, Read, Write
---

# 使用分层

按三级暴露使用，避免每次都把全部细节加载进上下文：

1. 先读本文件：只做任务分流、边界判断、字段类型速查、返回格式说明
2. 需要具体 API 参数时再读 `references/mcp-tools-reference.md`
3. 需要可复制的 curl 命令时再读 `references/curl-templates.md`
4. 高频路径优先用 `scripts/` 下的脚本，只有脚本不覆盖时才手写 curl

> 原则：本文件只放协议约束、字段格式速查、高频流程和返回示例；具体 API 参数下沉到参考文件。

# 硬约束（违反即失败）

## MCP 协议

- 所有请求必须为 JSON-RPC 2.0：`{"jsonrpc":"2.0","id":"<ID>","method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`
- 端点固定：`https://qyapi.weixin.qq.com/mcp/robot-doc`
- API Key 通过 URL QueryString 传入：`?apikey=$KEY`
- **必须带 Accept: application/json 请求头**，否则返回 -32600 Not Acceptable
- 异步操作（`get_doc_content`、`smartpage_export_task` → `smartpage_get_export_result`）必须轮询
- 轮询时仍需传入定位参数（`docid`/`url` 之一），不能只传 `task_id`
- 实际返回是 `{result: {content: [{type: "text", text: "<JSON字符串>"}]}}`。提取真正的业务 JSON 需多做一层 `JSON.parse(result.content[0].text)`

## 凭据安全

- **禁止** `echo` / `cat` API Key 到 stdout
- **禁止**将 API Key 赋给 shell 变量后再引用
- 脚本调用必须让脚本自己读取 `/workspace/.wecom-mcp.env`，不要把 API Key 作为命令行参数传入
- 手写 curl 时必须从配置文件内联读取：`$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)`
- 配置文件 `/workspace/.wecom-mcp.env` 权限必须是 600

## 智能表格（核心约束）

### 字段创建流程（必须严格按顺序）

新建智能表格后，默认子表自带一个名为 "文本"（create_doc 创建）或 "智能表列"（smartsheet_add_sheet 创建）的默认字段。

1. `smartsheet_get_sheet` → 获取 `sheet_id`
2. `smartsheet_get_fields` → 查出默认字段的 `field_id`
3. `smartsheet_update_fields` → 将默认字段**重命名**为你需要的第1个字段名
4. `smartsheet_add_fields` → **只添加剩余字段**（不含第1个）

如果跳过步骤3直接 add_fields，会多出一个无用的默认列。

### 记录写入 key 必须用字段标题

```
正确: {"姓名": [{"type":"text","text":"张三"}], "年龄": 25}
错误: {"f04Gwj": [{"type":"text","text":"张三"}]}
```

### smartsheet_update_records 的 key_type

`smartsheet_update_records` 支持 `key_type` 参数：
- `CELL_VALUE_KEY_TYPE_FIELD_TITLE`（默认）→ key 用字段标题
- `CELL_VALUE_KEY_TYPE_FIELD_ID` → key 用字段 ID

### 不可更新的字段

创建时间、最后编辑时间、创建人、最后编辑人这四种字段不支持通过 `update_records` 更新。

### 各字段类型写入格式速查

| 字段类型 | 值格式 | 示例 |
|---|---|---|
| TEXT | `[{"type":"text","text":"内容"}]` | 数组必加外层方括号 |
| NUMBER/CURRENCY/PERCENTAGE/PROGRESS | 直接数字 | `100` |
| CHECKBOX | 布尔值 | `true` / `false` |
| SINGLE_SELECT/SELECT | `[{"text":"选项内容"}]` 或 `[{"id":"选项id"}]` | 不能用纯字符串 |
| DATE_TIME | ISO 格式字符串 | `"2026-04-30"` 或 `"2026-04-30 14:30:00"` |
| PHONE_NUMBER/EMAIL/BARCODE | 纯字符串 | `"13800138000"` |
| USER | `[{"user_id":"成员ID"}]` | 数组 |
| URL | `[{"type":"url","text":"显示文本","link":"https://..."}]` | 数组 |
| IMAGE | `[{"image_url":"upload_doc_image获得的URL","title":"标题"}]` | 数组 |
| ATTACHMENT | `[{"file_id":"upload_doc_file获得的ID"}]` | 数组 |
| LOCATION | `[{"source_type":1,"id":"地点ID","latitude":"39.9","longitude":"116.4","title":"北京"}]` | 数组 |

> SINGLE_SELECT/SELECT 选项的 id 是选项值内部的 id（从 smartsheet_get_fields 返回的 options 中获取），不是 field_id
> 写入时可传 `{"text":"新选项"}` 自动创建新选项，也可传 `{"id":"选项id"}` 匹配已有选项

## 工具约束

- 只允许 `curl` + `python3 stdlib`（JSON 处理）
- 禁止 `pip install` 任何包
- curl 默认带 `-sS`（静默 + 显示错误）

## 限制与上限

| 项目 | 限制 |
|---|---|
| 记录单次操作 | 建议 ≤ 500 行 |
| 单子表最大字段数 | 150 |
| 上传图片大小上限 | 30MB (base64编码前) |
| 上传文件大小上限 | 10MB (base64编码前) |
| 文档名字符数 | ≤ 255 |
| 文件名长度 | ≤ 255 字符（英文算1，汉字算2） |

## 错误止损

| 错误信号 | 立即动作 |
|---|---|
| HTTP 非 200 | 读取响应体 `error` 字段判断错误类型 |
| JSON-RPC `-32600` | 检查是否缺少 `Accept: application/json` 请求头 |
| `errcode: 2022001` | Smartsheet 子表未找到，检查 sheet_id |
| `errcode` 非 0 | 可重试 1 次；仍失败则展示 errcode + errmsg |
| 轮询超过 10 次未完成 | 停止，告知用户 task_id |

# Preflight

每次开始前检查 API Key 是否存在并可用：

```bash
if [ ! -f /workspace/.wecom-mcp.env ]; then
  echo "API_KEY_MISSING"
  exit 1
fi

if [ "$(stat -c '%a' /workspace/.wecom-mcp.env)" != "600" ]; then
  echo "API_KEY_FILE_PERMISSIONS"
  exit 3
fi

if ! python3 /data/openclaw/skills/wecom-mcp-doc/scripts/mcp_call.py >/dev/null; then
  echo "API_KEY_INVALID"
  exit 2
fi

echo "API_KEY_VALID"
```

按结果处理：

| 结果 | 处理 |
|---|---|
| `API_KEY_MISSING` | 引导用户按照企业微信官方文档获取 API Key：https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21672 「3.3 方式3：智能机器人应用内授权」章节。拿到 key 后写入 `/workspace/.wecom-mcp.env` |
| `API_KEY_FILE_PERMISSIONS` | 执行 `chmod 600 /workspace/.wecom-mcp.env` 后重试 |
| `API_KEY_INVALID` | Key 存在但已失效（过期或被吊销），告知用户去企微管理后台检查 key 有效期、重新生成 |
| `API_KEY_VALID` | 继续执行任务 |

### 用户配置 API Key 的方式

引导用户访问 https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21672，按「3.3 方式3：智能机器人应用内授权」章节操作。拿到 key 后，用户可以从企微后台复制以下两种格式之一发给你：

**格式一：Streamable HTTP URL**
```
https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=xxx
```
从中提取 `apikey=` 后面的值写入文件。

**格式二：JSON Config**
```json
{"mcpServers":{"企业微信文档":{"type":"streamable-http","url":"https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=xxx"}}}
```
从中提取 `?apikey=` 后面的值写入文件。

收到后写入 `/workspace/.wecom-mcp.env`：

```bash
echo 'WECOM_MCP_APIKEY=extracted-key' > /workspace/.wecom-mcp.env
chmod 600 /workspace/.wecom-mcp.env
```

> 这个机器人的唯一用途是获取 MCP API Key，与 OpenClaw 收发消息用的 bot 无关。Key 有过期时间，在企微管理后台可查。

# 高频快路径

| 场景 | 常见触发词 | 首选路径 | 需要读的参考 |
|---|---|---|---|
| 探索可用工具 | `list` `tools` `有哪些能力` | Recipe A | 本文件 |
| 创建文档/智能表格 | `create_doc` `新建文档` `创建表格` | Recipe B | `mcp-tools-reference.md` |
| 导出/读取文档 | `get_doc_content` `导出` `读取` | `scripts/doc_content_export.py` | 本文件 |
| 智能表格结构 | `get_sheet` `get_fields` `add_fields` | Recipe D | `mcp-tools-reference.md` |
| 智能表格记录 | `add_records` `update_records` `delete_records` | Recipe E | 本文件字段格式速查 + `mcp-tools-reference.md` |
| 上传图片/文件 | `upload_doc_image` `upload_doc_file` | Recipe F | `mcp-tools-reference.md` |
| 智能文档 | `smartpage_create` `smartpage_export` | Recipe G | `mcp-tools-reference.md` |

# 脚本快路径

脚本路径均相对本 skill 目录。优先用脚本处理高频、易漏参数、需要轮询的流程。

## 读取/导出文档

`get_doc_content` 必须传 `type` 且需要异步轮询。直接用脚本：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/doc_content_export.py \
  --docid "DOCID" \
  --out /workspace/doc-content.md
```

或用 URL 定位：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/doc_content_export.py \
  --url "https://doc.weixin.qq.com/doc/..." \
  --out /workspace/doc-content.md
```

默认参数：
- `--type 2`
- `--polls 20`
- `--interval 1.5`
- `--env-file /workspace/.wecom-mcp.env`

机器可读输出：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/doc_content_export.py \
  --docid "DOCID" \
  --out /workspace/doc-content.md \
  --json
```

输出成功后只向用户返回文件路径和摘要，不要粘贴整篇正文。

## 通用工具调用

低频工具可以用通用调用脚本，脚本会自动解包 MCP `content[0].text`：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/mcp_call.py \
  --tool smartsheet_get_sheet \
  --arguments '{"docid":"DOCID"}'
```

探索工具列表：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/mcp_call.py
```

# 通用规则

## 文档定位方式

所有工具都支持两种定位方式，二选一：

| 方式 | 示例 | 来源 |
|---|---|---|
| `docid` | `dcBStrGQ...` | `create_doc` 返回 |
| `url` | `https://doc.weixin.qq.com/smartsheet/s3_...` | 浏览器地址栏 |

等价调用：`{"docid": "xxx"}` 或 `{"url": "https://..."}`

## 返回格式（重要）

所有 `tools/call` 返回都包裹在 MCP content 里：

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "content": [{"type": "text", "text": "<业务JSON字符串>"}],
    "isError": false
  }
}
```

**必须先解析 `content[0].text` 字符串才能拿到真正的业务数据。** 用 python3 处理：

```bash
curl ... | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

## 异步轮询

`get_doc_content` 和 `smartpage_export_task` → `smartpage_get_export_result`：

```
第1次 → 返回 {task_id, task_done: false}
轮询 → 带 task_id + docid/url → task_done 变 true 时拿到 content
轮询超过 10 次 → 停止，报告 task_id
```

## 输出规范

- 创建类：返回 `docid` + 完整 `url`，不要截短或去掉 `?scode=` 等参数
- 查询类：返回核心字段 + 查询条件
- 修改类：返回变更前后对比
- 导出类：正文保存到文件，返回文件路径 + 摘要
- 记录写入类：返回成功/失败行数
- 上传类：返回 `image_url` / `file_id` 供后续使用

## 规模治理

| 结果量 | 约束 |
|---|---|
| ≤ 500 条 | 允许单次操作 |
| 500 ~ 2000 条 | 分批 ≤ 500/批 |
| > 2000 条 | 告知用户规模，建议分多次 |

# Recipe A: 探索工具列表

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'{t[\"name\"]}: {t[\"description\"][:100]}') for t in d['result']['tools']]"
```

返回 20 个工具，涵盖文档/智能表格/智能文档/上传四大类。

# Recipe B: 创建文档/智能表格

### 创建文档 (doc_type=3)

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"create_doc","arguments":{"doc_type":3,"doc_name":"标题"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(f'docid={inner[\"docid\"]} url={inner[\"url\"]}')"
```

### 创建智能表格 (doc_type=10)

doc_type 改为 10。返回示例：
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "url": "https://doc.weixin.qq.com/smartsheet/s3_xxx?scode=xxx",
  "docid": "dcBStrGQ..."
}
```

### 注意
- 创建成功后**原样**返回 url 给用户，不要截短或删查询参数
- 新建智能表格默认含一个名为 "智能表1" 的子表 + 一个名为 "文本" 的默认字段

# Recipe C: 导出文档内容

### 首次

```bash
curl ... -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"get_doc_content","arguments":{"docid":"DOCID","type":2}}}'
```

返回：`{"errcode":0,"errmsg":"ok","task_id":"xxx","task_done":false}`

### 轮询

带上 `task_id` 重试，直到 `task_done: true`，从 `content` 字段取 Markdown。

### 用 python3 包装轮询

见 `references/curl-templates.md`。

# Recipe D: 智能表格结构管理

### 标准流程（已验证）

```
步骤1: smartsheet_get_sheet → sheet_id
步骤2: smartsheet_get_fields → field_id（默认字段）
步骤3: smartsheet_update_fields → 重命名默认字段
步骤4: smartsheet_add_fields → 添加剩余字段
```

### get_sheet 返回示例

```json
{
  "errcode": 0,
  "sheet_list": [
    {"sheet_id": "q979lj", "title": "智能表1", "is_visible": true, "type": "smartsheet"}
  ]
}
```

### get_fields 返回示例

```json
{
  "errcode": 0,
  "fields": [
    {"field_id": "f04Gwj", "field_title": "文本", "field_type": "FIELD_TYPE_TEXT", "property_text": {}}
  ]
}
```

字段有类型特定的 property：`property_number`（decimal_places, use_separate）、`property_single_select`（is_multiple, is_quick_add, options）等。

### update_fields 返回示例

```json
{
  "errcode": 0,
  "fields": [
    {"field_id": "f04Gwj", "field_title": "姓名", "field_type": "FIELD_TYPE_TEXT"}
  ]
}
```

### add_fields 返回示例

```json
{
  "errcode": 0,
  "fields": [
    {"field_id": "fxrtEy", "field_title": "年龄", "field_type": "FIELD_TYPE_NUMBER", "property_number": {"decimal_places":0, "use_separate":false}},
    {"field_id": "f5O4HK", "field_title": "部门", "field_type": "FIELD_TYPE_SINGLE_SELECT", "property_single_select": {"is_multiple":false, "is_quick_add":true, "options":[]}}
  ]
}
```

# Recipe E: 智能表格记录操作

### 添加记录（已验证）

```bash
-d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartsheet_add_records","arguments":{"docid":"DOCID","sheet_id":"SID","records":[{"values":{"姓名":[{"type":"text","text":"张三"}],"年龄":28,"部门":[{"text":"研发部"}]}}]}}}'
```

返回：
```json
{
  "errcode": 0,
  "records": [
    {"record_id": "KNT0Jt", "values": {"姓名":[{"text":"张三","type":"text"}],"年龄":28,"部门":["o3avjE"]}}
  ]
}
```

> 写入时 SINGLE_SELECT 的值以选项 ID 形式返回；查询时展开为 `{"id":"xxx","style":1,"text":"研发部"}`

### 查询记录

返回：
```json
{
  "errcode": 0, "total": 2, "has_more": false, "next": 2, "ver": 4,
  "records": [
    {
      "record_id": "KNT0Jt",
      "create_time": "1777536022619",
      "update_time": "1777536022619",
      "values": {"姓名":[{"text":"张三","type":"text"}],"年龄":28},
      "creator_name": "李睿的机器人",
      "updater_name": "李睿的机器人"
    }
  ]
}
```

> 时间戳是**毫秒**字符串；分页通过 `next` 偏移量

### 更新记录

```json
{"name":"smartsheet_update_records","arguments":{"docid":"DOCID","sheet_id":"SID","records":[{"record_id":"KNT0Jt","values":{"年龄":30}}]}}
```

可选 `key_type` 参数控制 values key 使用字段标题还是字段 ID。

### 删除记录（不可逆）

```json
{"name":"smartsheet_delete_records","arguments":{"docid":"DOCID","sheet_id":"SID","record_ids":["KNT0Jt"]}}
```

# Recipe F: 上传图片/文件

### 上传图片 — 参数名 `base64_content`

```bash
IMG_BASE64="$(base64 -w0 /path/to/image.png)"
curl ... -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"upload_doc_image\",\"arguments\":{\"docid\":\"DOCID\",\"base64_content\":\"$IMG_BASE64\"}}}"
```

返回：`{"errcode":0,"errmsg":"ok","url":"...","width":...,"height":...,"size":...}`

使用返回的 `url` 填充 IMAGE 字段：`[{"image_url":"返回的url","title":"图片标题"}]`

### 上传文件 — 参数名 `file_name` + `file_base64_content`

```bash
FILE_BASE64="$(base64 -w0 /path/to/file.pdf)"
curl ... -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"upload_doc_file\",\"arguments\":{\"file_name\":\"file.pdf\",\"file_base64_content\":\"$FILE_BASE64\"}}}"
```

返回：`{"errcode":0,"errmsg":"ok","file_id":"xxx","name":"file.pdf"}`

使用返回的 `file_id` 填充 ATTACHMENT 字段：`[{"file_id":"xxx"}]`

# Recipe G: 智能文档（Smartpage）

### 创建

```json
{"name":"smartpage_create","arguments":{"title":"智能文档标题","pages":[{"page_title":"页面1","content_type":1,"page_content":"# Markdown 内容"}]}}
```

返回：`{"errcode":0,"errmsg":"ok","docid":"xxx","url":"https://..."}`

- `content_type`: 0=纯文本（默认），1=Markdown

### 导出（异步）

1. `smartpage_export_task` → 获得 task_id
2. `smartpage_get_export_result` → 轮询拿到 content

# 长尾能力导航

- 编辑文档正文：`edit_doc_content`，见 `references/mcp-tools-reference.md`
- 添加/删除子表：`smartsheet_add_sheet` / `smartsheet_delete_sheet`（不可逆）
- 更改子表标题：`smartsheet_update_sheet`（嵌套 `properties.title` 格式）
- 删除字段：`smartsheet_delete_fields`（不可逆）
- 分享文档：`share_doc` / `get_doc_share_link` / `get_doc_auth`

# 可用工具全览（20个）

**文档操作（5）:** `create_doc`, `get_doc_content`, `edit_doc_content`, `share_doc`, `get_doc_auth`

**智能表格-表结构（5）:** `smartsheet_get_sheet`, `smartsheet_add_sheet`, `smartsheet_update_sheet`, `smartsheet_delete_sheet`, `smartsheet_get_fields`

**智能表格-字段（2）:** `smartsheet_add_fields`, `smartsheet_update_fields`, `smartsheet_delete_fields`

**智能表格-记录（4）:** `smartsheet_get_records`, `smartsheet_add_records`, `smartsheet_update_records`, `smartsheet_delete_records`

**上传（2）:** `upload_doc_image`, `upload_doc_file`

**智能文档（3）:** `smartpage_create`, `smartpage_export_task`, `smartpage_get_export_result`

**其他（1）:** `get_doc_share_link`

# 参考入口

- 具体 API 参数：`references/mcp-tools-reference.md`
- curl 调用模板：`references/curl-templates.md`
