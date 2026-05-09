# curl 调用模板

本文档是可复制的 curl 命令模板。所有命令已在 `https://qyapi.weixin.qq.com/mcp/robot-doc` 实测通过。

## 公共变量提取

优先用 `scripts/` 下的脚本，它们会自行读取 `/workspace/.wecom-mcp.env`，不要把 API Key 暴露在命令行参数里。

仅在脚本不覆盖、必须手写 curl 排障时使用下面的内联读取方式。

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
```

**重要规则**：
- curl 必须带 `-sS`（静默 + show error）
- 必须带 `Accept: application/json`，否则返回 `-32600 Not Acceptable`
- 实际响应包裹在 MCP content 中，需多做一层 JSON 解析
- 获取业务数据：`python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(inner)"`

---

## 1. 探索工具列表

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in d['result']['tools']:
    name = t['name']
    desc = t['description'].replace('\n',' ')[:120]
    required = t.get('inputSchema',{}).get('required',[])
    print(f'{name} (required: {required})')
    print(f'  {desc}')
    print()
"
```

---

## 2. 创建文档（doc_type=3）

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"create_doc","arguments":{"doc_type":3,"doc_name":"项目周报"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回示例：
```json
{"errcode":0,"errmsg":"ok","url":"https://doc.weixin.qq.com/doc/w3_...?scode=...","docid":"dcBStr..."}
```

---

## 3. 创建智能表格（doc_type=10）

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"create_doc","arguments":{"doc_type":10,"doc_name":"任务跟踪表"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回：
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "url": "https://doc.weixin.qq.com/smartsheet/s3_...?scode=...",
  "docid": "dcBStrGQ2nQskJ7fm2jCqK..."
}
```

**重要**：创建智能表格后默认含一个名为 "智能表1" 的子表 + 一个名为 "文本" 的 TEXT 字段。

---

## 4. 导出文档内容（异步轮询）

优先使用脚本，不要手写两段 curl：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/doc_content_export.py \
  --docid "DOCID" \
  --out /workspace/doc-content.md
```

或：

```bash
python3 /data/openclaw/skills/wecom-mcp-doc/scripts/doc_content_export.py \
  --url "https://doc.weixin.qq.com/doc/..." \
  --out /workspace/doc-content.md
```

下面的 curl 仅用于脚本不可用时排障。

### 4.1 首次调用

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"get_doc_content","arguments":{"docid":"DOCID","type":2}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回：`{"errcode":0,"errmsg":"ok","task_id":"xxx","task_done":false}`

### 4.2 用 python3 包装完整轮询

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
DOCID="your-docid-here"

python3 << 'PYEOF'
import json, subprocess, time, sys

apikey = sys.argv[1]
docid = sys.argv[2]
task_id = None

for i in range(10):
    args_dict = {"docid": docid, "type": 2}
    if task_id:
        args_dict["task_id"] = task_id

    body = {
        "jsonrpc": "2.0", "id": f"poll-{i}",
        "method": "tools/call",
        "params": {"name": "get_doc_content", "arguments": args_dict}
    }

    result = subprocess.run([
        "curl", "-sS", "-X", "POST",
        f"https://qyapi.weixin.qq.com/mcp/robot-doc?apikey={apikey}",
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json",
        "-d", json.dumps(body)
    ], capture_output=True, text=True)

    outer = json.loads(result.stdout)
    inner = json.loads(outer["result"]["content"][0]["text"])

    if not task_id:
        task_id = inner.get("task_id")

    if inner.get("task_done"):
        with open("/tmp/doc_content.md", "w") as f:
            f.write(inner["content"])
        print(f"Done: {len(inner['content'])} chars → /tmp/doc_content.md")
        sys.exit(0)

    print(f"Poll {i+1}: task_done=false, waiting 1.5s...")
    time.sleep(1.5)

print(f"ERROR: polling exhausted after 10 attempts, task_id={task_id}")
PYEOF
```

---

## 5. 编辑文档内容（Markdown 覆写）

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"edit_doc_content","arguments":{"docid":"DOCID","content":"# 标题\n\n正文内容","content_type":1}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

> content 直接传原始 Markdown，不要额外 JSON 转义

---

## 6. 智能表格结构 — 完整初始化（已验证）

### 6.1 获取子表 sheet_id

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"smartsheet_get_sheet\",\"arguments\":{\"docid\":\"DOCID\"}}}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
inner = json.loads(d['result']['content'][0]['text'])
print(json.dumps(inner, indent=2, ensure_ascii=False))
sheet_id = inner['sheet_list'][0]['sheet_id']
print(f'\nSHEET_ID = {sheet_id}')
"
```

返回示例：
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "sheet_list": [
    {"sheet_id": "q979lj", "title": "智能表1", "is_visible": true, "type": "smartsheet"}
  ]
}
```

### 6.2 获取字段（查默认字段 field_id）

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"smartsheet_get_fields","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回示例：
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

### 6.3 重命名默认字段

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"smartsheet_update_fields","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID","fields":[{"field_id":"f04Gwj","field_title":"姓名","field_type":"FIELD_TYPE_TEXT"}]}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

### 6.4 添加其余字段（不含第1个）

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"4","method":"tools/call","params":{"name":"smartsheet_add_fields","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID","fields":[{"field_title":"年龄","field_type":"FIELD_TYPE_NUMBER"},{"field_title":"邮箱","field_type":"FIELD_TYPE_EMAIL"},{"field_title":"部门","field_type":"FIELD_TYPE_SINGLE_SELECT"}]}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回示例：
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "fields": [
    {"field_id":"fxrtEy","field_title":"年龄","field_type":"FIELD_TYPE_NUMBER","property_number":{"decimal_places":0,"use_separate":false}},
    {"field_id":"fMgdRL","field_title":"邮箱","field_type":"FIELD_TYPE_EMAIL"},
    {"field_id":"f5O4HK","field_title":"部门","field_type":"FIELD_TYPE_SINGLE_SELECT","property_single_select":{"is_multiple":false,"is_quick_add":true,"options":[]}}
  ]
}
```

---

## 7. 添加记录（已验证）

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"5","method":"tools/call","params":{"name":"smartsheet_add_records","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID","records":[{"values":{"姓名":[{"type":"text","text":"张三"}],"年龄":28,"邮箱":"zhangsan@example.com","部门":[{"text":"研发部"}]}},{"values":{"姓名":[{"type":"text","text":"李四"}],"年龄":32,"邮箱":"lisi@example.com","部门":[{"text":"产品部"}]}}]}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回：
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "records": [
    {"record_id":"KNT0Jt","values":{"姓名":[{"text":"张三","type":"text"}],"年龄":28,"邮箱":"zhangsan@example.com","部门":["o3avjE"]}},
    {"record_id":"JuOngp","values":{"姓名":[{"text":"李四","type":"text"}],"年龄":32,"邮箱":"lisi@example.com","部门":["orP1Xt"]}}
  ]
}
```

### 大 payload 用文件方式

```bash
python3 << 'PYEOF'
import json
records = []
for i in range(100):
    records.append({"values": {"姓名":[{"type":"text","text":f"用户{i}"}],"年龄":20+i}})
body = {"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartsheet_add_records","arguments":{"docid":"DOCID","sheet_id":"SID","records":records}}}
with open('/tmp/mcp_body.json','w') as f:
    json.dump(body, f)
PYEOF

curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d @/tmp/mcp_body.json | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(f'Added {len(inner[\"records\"])} records, errcode={inner[\"errcode\"]}')"
```

---

## 8. 查询记录

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartsheet_get_records","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID"}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False)[:2000])"
```

返回示例：
```json
{
  "errcode": 0, "errmsg": "ok", "total": 2, "has_more": false, "next": 2, "ver": 4,
  "records": [
    {
      "record_id": "KNT0Jt",
      "create_time": "1777536022619",
      "update_time": "1777536022619",
      "values": {"姓名":[{"text":"张三","type":"text"}],"年龄":28,"邮箱":"zhangsan@example.com","部门":[{"id":"o3avjE","style":1,"text":"研发部"}]},
      "creator_name": "李睿的机器人",
      "updater_name": "李睿的机器人"
    }
  ]
}
```

> 查询时 SINGLE_SELECT 字段展开为完整对象 `{"id":"xxx","style":1,"text":"研发部"}`

---

## 9. 更新记录

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartsheet_update_records","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID","records":[{"record_id":"KNT0Jt","values":{"年龄":30}}]}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

可选参数 `key_type`：
- `"CELL_VALUE_KEY_TYPE_FIELD_TITLE"`（默认）— values key 用字段标题
- `"CELL_VALUE_KEY_TYPE_FIELD_ID"` — values key 用字段 ID

---

## 10. 删除记录（不可逆）

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartsheet_delete_records","arguments":{"docid":"DOCID","sheet_id":"SHEET_ID","record_ids":["KNT0Jt","JuOngp"]}}}'
```

---

## 11. 上传图片 — 参数名 `base64_content`

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
IMAGE_PATH="/path/to/image.png"
IMAGE_BASE64="$(base64 -w0 "$IMAGE_PATH")"

curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"upload_doc_image\",\"arguments\":{\"docid\":\"DOCID\",\"base64_content\":\"$IMAGE_BASE64\"}}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回：`{"errcode":0,"errmsg":"ok","url":"https://...","width":800,"height":600,"size":12345}`

---

## 12. 上传文件 — 参数名 `file_name` + `file_base64_content`

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
FILE_PATH="/path/to/file.pdf"
FILE_BASE64="$(base64 -w0 "$FILE_PATH")"
FILE_NAME="$(basename "$FILE_PATH")"

curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"upload_doc_file\",\"arguments\":{\"file_name\":\"$FILE_NAME\",\"file_base64_content\":\"$FILE_BASE64\"}}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

返回：`{"errcode":0,"errmsg":"ok","file_id":"xxx","name":"file.pdf"}`

---

## 13. 智能文档（Smartpage）创建

```bash
APIKEY="$(grep -E '^WECOM_MCP_APIKEY=' /workspace/.wecom-mcp.env 2>/dev/null | cut -d= -f2-)"
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartpage_create","arguments":{"title":"智能文档","pages":[{"page_title":"首页","content_type":1,"page_content":"# 欢迎\n\n这是智能文档首页"}]}}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); inner=json.loads(d['result']['content'][0]['text']); print(json.dumps(inner, indent=2, ensure_ascii=False))"
```

> content_type: 0=纯文本（默认），1=Markdown

---

## 14. 智能文档导出（异步）

### 发起导出

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartpage_export_task","arguments":{"docid":"DOCID","content_type":1}}}'
```

### 轮询结果

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartpage_get_export_result","arguments":{"task_id":"TASK_ID"}}}'
```

---

## 15. 更新子表标题 — 嵌套格式

```bash
curl -sS -X POST "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=$APIKEY" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"smartsheet_update_sheet","arguments":{"docid":"DOCID","properties":{"sheet_id":"SHEET_ID","title":"新标题"}}}}'
```

注意格式：`properties.sheet_id` + `properties.title`，不是扁平的 `sheet_id` + `title`。

---
