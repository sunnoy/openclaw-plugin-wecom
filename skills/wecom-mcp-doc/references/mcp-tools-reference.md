# MCP Tools 参数参考

本文档基于 `tools/list` 实测结果编写，所有参数名、必填项、返回格式均经过验证。

## 响应解析规则

所有 `tools/call` 的 HTTP 响应格式：

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

先用 `json.loads(response["result"]["content"][0]["text"])` 解析 `text` 字段才能拿到业务数据。

---

## create_doc

创建文档（doc_type=3）或智能表格（doc_type=10）。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `doc_type` | integer | 是 | `3`=文档，`10`=智能表格 |
| `doc_name` | string | 是 | 文档标题，≤255字符，超过会被截断 |

### 返回（成功时）

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `errmsg` | string | `"ok"` |
| `url` | string | 文档完整链接，**保留所有查询参数** |
| `docid` | string | 文档 ID，后续所有操作需要 |

### 实测返回示例

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "url": "https://doc.weixin.qq.com/smartsheet/s3_AHIAsniYAAkCNukXRUoJRSk6tGai4_a?scode=AKkASwcLAAw0ce46XCAHIAsniYAAk",
  "docid": "dcBStrGQ2nQskJ7fm2jCqKy7rwl1213q-8twfzizXFynBlpQ7Jp3LHVPD0TXTbAnFAgdClnnzSRzdqTyQnU62azA"
}
```

### 注意

- 新建智能表格（doc_type=10）默认含一个名为 **"智能表1"** 的子表 + 一个名为 **"文本"** 的 TEXT 字段
- 后续必须走完整字段初始化流程：get_sheet → get_fields → update_fields(rename) → add_fields(rest)

---

## get_doc_content

获取文档内容，仅支持 Markdown 格式（type=2）。**异步轮询机制**。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |
| `type` | integer | 是 | 固定 `2`（Markdown） |
| `task_id` | string | 轮询时 | 首次不传，后续携带上一轮返回的值 |

### 轮询流程

1. 首次不带 `task_id` → 获得 `{task_id, task_done: false}`
2. 携带 `task_id` + `docid`/`url` + `type` 轮询
3. `task_done: true` 时，`content` 字段含 Markdown 正文
4. 超过 10 次未完成 → 停止并报告 task_id

### 返回（task_done 时）

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `task_done` | bool | `true` 完成 |
| `content` | string | Markdown 格式正文 |

---

## edit_doc_content

用 Markdown 覆写文档正文。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | 是 | Markdown 原始文本，如 `"# 标题\n正文"`，**不要**额外 JSON 转义 |
| `content_type` | integer | 是 | 固定 `1`（Markdown） |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `errmsg` | string | `"ok"` |

---

## smartsheet_get_sheet

查询文档中所有子表。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `sheet_list` | array | 子表数组 |

### sheet_list 每项

| 字段 | 类型 | 说明 |
|------|------|------|
| `sheet_id` | string | 子表 ID（后续所有操作需要） |
| `title` | string | 子表标题 |
| `is_visible` | bool | 是否可见 |
| `type` | string | `"smartsheet"` |

### 实测返回示例

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "sheet_list": [
    {"sheet_id": "q979lj", "title": "智能表1", "is_visible": true, "type": "smartsheet"}
  ]
}
```

---

## smartsheet_add_sheet

添加空子表。新建的智能表格默认已有子表，仅在需要多个子表时使用。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `properties` | object | 否 | `{"title": "子表名"}` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

**注意**：新子表自带一个默认字段（标题 "智能表列"），同样需要走完整初始化流程。

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |

---

## smartsheet_update_sheet

修改子表标题。**参数是嵌套格式，不是扁平的。**

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `properties` | object | 是 | `{"sheet_id": "xxx", "title": "新标题"}` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 调用格式

```json
{"docid":"DOCID","properties":{"sheet_id":"SID","title":"新标题"}}
```

**不是** `{"docid":"DOCID","sheet_id":"SID","title":"新标题"}`

---

## smartsheet_delete_sheet

永久删除子表，**操作不可逆**。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 要删除的子表 ID |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

---

## smartsheet_get_fields

获取子表的所有字段（列）。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `total` | int | 字段总数 |
| `has_more` | bool | 是否有更多 |
| `next` | int | 分页偏移 |
| `fields` | array | 字段数组 |

### fields 每项

| 字段 | 类型 | 说明 |
|------|------|------|
| `field_id` | string | 字段 ID |
| `field_title` | string | 字段标题（创建表格记录时用作 key） |
| `field_type` | string | 字段类型常量 |
| `property_text` | object | TEXT 属性（通常为 `{}`） |
| `property_number` | object | NUMBER 属性：`{decimal_places, use_separate}` |
| `property_single_select` | object | 单选属性：`{is_multiple, is_quick_add, options[]}` |

### 实测返回示例

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "total": 1,
  "has_more": false,
  "next": 0,
  "fields": [
    {"field_id": "f04Gwj", "field_title": "文本", "field_type": "FIELD_TYPE_TEXT", "property_text": {}}
  ]
}
```

---

## smartsheet_add_fields

添加字段。单子表最多 150 个字段。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `fields` | array | 是 | `[{"field_title":"名称","field_type":"FIELD_TYPE_XXX"}]` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 前提条件

调用前必须已完成：`get_fields` → `update_fields`（重命名默认字段）。本接口只传**剩余**字段。

### 字段类型常量

| 常量 | 说明 |
|------|------|
| `FIELD_TYPE_TEXT` | 文本 |
| `FIELD_TYPE_NUMBER` | 数字 |
| `FIELD_TYPE_CHECKBOX` | 复选框 |
| `FIELD_TYPE_DATE_TIME` | 日期时间 |
| `FIELD_TYPE_SINGLE_SELECT` | 单选 |
| `FIELD_TYPE_SELECT` | 多选 |
| `FIELD_TYPE_PHONE_NUMBER` | 手机号 |
| `FIELD_TYPE_EMAIL` | 邮箱 |
| `FIELD_TYPE_URL` | 超链接 |
| `FIELD_TYPE_IMAGE` | 图片 |
| `FIELD_TYPE_ATTACHMENT` | 附件 |
| `FIELD_TYPE_USER` | 成员 |
| `FIELD_TYPE_LOCATION` | 位置 |
| `FIELD_TYPE_CURRENCY` | 货币 |
| `FIELD_TYPE_PERCENTAGE` | 百分比 |
| `FIELD_TYPE_PROGRESS` | 进度 |
| `FIELD_TYPE_BARCODE` | 条码 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `fields` | array | 新创建的字段数组（含 field_id、field_type、property_xxx） |

---

## smartsheet_update_fields

更新字段。**只能改名，不能改类型**。field_type 必须传原始类型，field_title 不能更新为原值。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `fields` | array | 是 | `[{"field_id":"xxx","field_title":"新名","field_type":"FIELD_TYPE_XXX"}]` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `fields` | array | 更新后的字段数组 |

---

## smartsheet_delete_fields

删除字段，**操作不可逆**。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `field_ids` | array | 是 | `["f04Gwj", "fxrtEy"]` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

---

## smartsheet_get_records

查询子表全部记录。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `total` | int | 总记录数 |
| `has_more` | bool | 是否有下一页 |
| `next` | int | 下一页偏移量 |
| `ver` | int | 版本号 |
| `records` | array | 记录数组 |

### records 每项

| 字段 | 类型 | 说明 |
|------|------|------|
| `record_id` | string | 记录 ID（用于更新/删除） |
| `create_time` | string | 创建时间（**毫秒**时间戳字符串） |
| `update_time` | string | 最后编辑时间（**毫秒**时间戳字符串） |
| `values` | object | 字段值，key 为字段标题 |
| `creator_name` | string | 创建人名称 |
| `updater_name` | string | 最后编辑人名称 |

### 实测返回示例

```json
{
  "errcode": 0, "errmsg": "ok",
  "total": 2, "has_more": false, "next": 2, "ver": 4,
  "records": [
    {
      "record_id": "KNT0Jt",
      "create_time": "1777536022619",
      "update_time": "1777536022619",
      "values": {
        "姓名": [{"text": "张三", "type": "text"}],
        "年龄": 28,
        "邮箱": "zhangsan@example.com",
        "部门": [{"id": "o3avjE", "style": 1, "text": "研发部"}]
      },
      "creator_name": "李睿的机器人",
      "updater_name": "李睿的机器人"
    }
  ]
}
```

注意 SINGLE_SELECT 在查询时展开为完整对象 `{id, style, text}`，而添加时返回的是选项 ID 字符串。

---

## smartsheet_add_records

添加记录。Key 必须用**字段标题**（field_title），不能是 field_id。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `records` | array | 是 | `[{"values": {"字段标题": value}}]` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 各字段类型 value 格式

#### 文本 (TEXT) — **必须数组，外层方括号不可省略**
```json
{"姓名": [{"type": "text", "text": "张三"}]}
```
CellTextValue: `{type: "text"|"url", text: string, link?: string}`

#### 数字/货币/百分比/进度
```json
{"金额": 100, "完成率": 0.6, "进度": 80}
```

#### 复选框
```json
{"已完成": true}
```

#### 单选/多选 — **必须数组**
```json
{"部门": [{"text": "研发部"}]}
// 或匹配已有选项
{"部门": [{"id": "o3avjE"}]}
```
Option: `{id?: string, style?: 1-27, text?: string}`
- 传 `text` 无 `id` → 自动创建新选项
- 传 `id` → 精确匹配已有选项
- `style` 控制颜色：1-27

#### 日期时间
```json
{"截止日期": "2026-01-15", "完成时间": "2026-01-15 14:30:00"}
```
支持：YYYY-MM-DD、YYYY-MM-DD HH:MM、YYYY-MM-DD HH:MM:SS。系统自动按东八区转换为时间戳。

#### 手机号/邮箱/条码
```json
{"电话": "13800138000", "邮箱": "test@example.com"}
```

#### 成员 (USER)
```json
{"负责人": [{"user_id": "zhangsan"}]}
```
CellUserValue: `{user_id: string}`

#### 超链接 (URL) — 数组，目前只支持一个链接
```json
{"参考链接": [{"type": "url", "text": "官网", "link": "https://example.com"}]}
```
CellUrlValue: `{type: "url", text?: string, link: string}`

#### 图片 (IMAGE)
```json
{"封面": [{"image_url": "通过upload_doc_image获取的URL", "title": "封面图"}]}
```
CellImageValue: `{image_url: string, title: string}`

#### 附件 (ATTACHMENT)
```json
{"文件": [{"file_id": "通过upload_doc_file获取的ID"}]}
```
CellAttachmentValue: `{file_id: string}`

#### 位置 (LOCATION)
```json
{"地点": [{"source_type": 1, "id": "地点ID", "latitude": "39.9", "longitude": "116.4", "title": "北京"}]}
```
CellLocationValue: `{source_type: 1, id, latitude, longitude, title}`

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `records` | array | `[{"record_id":"KNT0Jt","values":{...}}]` |

---

## smartsheet_update_records

更新记录。单次更新建议 500 行以内。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `records` | array | 是 | `[{"record_id":"xxx","values":{...}}]` |
| `key_type` | string | 否 | `"CELL_VALUE_KEY_TYPE_FIELD_TITLE"`（默认）或 `"CELL_VALUE_KEY_TYPE_FIELD_ID"` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 不可更新的字段

创建时间、最后编辑时间、创建人、最后编辑人四种字段不支持更新。

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `records` | array | 更新后的记录 |

---

## smartsheet_delete_records

删除记录，**操作不可逆**。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheet_id` | string | 是 | 子表 ID |
| `record_ids` | array | 是 | `["KNT0Jt", "JuOngp"]` |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

---

## upload_doc_image

上传图片到企业微信文档。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `base64_content` | string | 是 | Base64 编码的图片内容（≤30MB 编码前）。只需传入纯 base64，不要加 data URI 前缀 |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `url` | string | 图片访问链接，用于填充 IMAGE 字段 |
| `width` | int | 图片宽度（像素） |
| `height` | int | 图片高度（像素） |
| `size` | int | 图片大小（字节） |

---

## upload_doc_file

上传文件到企业微信文档。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_name` | string | 是 | 文件名。最多 255 字符，英文算 1 个，汉字算 2 个 |
| `file_base64_content` | string | 是 | 文件内容的 Base64 编码（≤10MB 编码前）。只需纯 base64，不要 data URI 前缀 |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `file_id` | string | 文件 ID，用于填充 ATTACHMENT 字段 |
| `name` | string | 文件名 |

---

## smartpage_create

创建智能文档（原"智能主页"）。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 智能文档标题 |
| `pages` | array | 是 | 子页面列表 |

### pages 每项

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `page_title` | string | 是 | 子页面标题 |
| `content_type` | integer | 否 | `0`=纯文本（默认），`1`=Markdown |
| `page_content` | string | 否 | 子页面内容，格式与 content_type 对应 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `docid` | string | 文档 ID |
| `url` | string | 访问链接 |

---

## smartpage_export_task

提交导出智能文档的异步任务。仅返回 task_id，实际内容需通过 `smartpage_get_export_result` 获取。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content_type` | integer | 是 | 固定 `1`（Markdown） |
| `docid` | string | 二选一 | 文档 ID |
| `url` | string | 二选一 | 文档链接 |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `task_id` | string | 用于后续轮询 |

---

## smartpage_get_export_result

查询导出任务状态和结果。异步轮询机制。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 导出任务 ID（由 smartpage_export_task 返回） |

### 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `errcode` | int | `0` 成功 |
| `task_done` | bool | `true` 时表示完成 |
| `content` | string | 完成时的导出内容 |

---

## share_doc / get_doc_auth / get_doc_share_link

文档分享相关工具。参数同通用模式：`docid` 或 `url` 二选一。

- `share_doc` — 分享文档给指定成员
- `get_doc_auth` — 查询文档权限
- `get_doc_share_link` — 获取文档分享链接

---

## 通用错误码

| errcode | 说明 | 处理 |
|---|---|---|
| `0` | 成功 | — |
| `2022001` | Smartsheet 子表未找到 | 检查 sheet_id |
| `851013`/`851014`/`851008` | 文档授权错误 | 需用户授权 |
| `846609` | 品类未开通 | 停止，告知用户 |
| JSON-RPC `-32600` | 缺少 Accept header | 加 `Accept: application/json` |
| JSON-RPC `-32001` | Server 不可用 | 重试 1 次 |
| JSON-RPC `-32003` | 认证失败 | 检查 API Key |
