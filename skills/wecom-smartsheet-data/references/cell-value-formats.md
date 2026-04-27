# 单元格值格式参考

在 `smartsheet_add_records` 和 `smartsheet_update_records` 中，`values` 的 key **必须是字段标题（field_title）**，不能使用字段 ID。

## 各字段类型的值格式

### 1. 文本 (FIELD_TYPE_TEXT)

**必须**使用数组格式，外层方括号不可省略：

```json
"字段标题": [{"type": "text", "text": "内容"}]
```

### 2. 数字 (NUMBER) / 货币 (CURRENCY) / 百分比 (PERCENTAGE) / 进度 (PROGRESS)

直接传数字：

```json
"金额": 100,
"完成率": 0.6,
"进度": 80
```

### 3. 复选框 (CHECKBOX)

直接传布尔值：

```json
"已完成": true
```

### 4. 单选 (SINGLE_SELECT) / 多选 (SELECT)

**必须**使用数组格式，不能直接传字符串：

```json
"优先级": [{"text": "高"}],
"标签": [{"text": "紧急"}, {"text": "重要"}]
```

选项可附带 `id`（已存在选项）和 `style`（颜色 1-27）。

### 5. 日期时间 (DATE_TIME)

传日期时间字符串，系统自动按东八区转换：

```json
"截止日期": "2026-01-15 14:30:00",
"创建日期": "2026-01-15"
```

支持格式：`YYYY-MM-DD HH:MM:SS`、`YYYY-MM-DD HH:MM`、`YYYY-MM-DD`

### 6. 手机号 (PHONE_NUMBER) / 邮箱 (EMAIL) / 条码 (BARCODE)

直接传字符串：

```json
"电话": "13800138000",
"邮箱": "test@example.com"
```

### 7. 成员 (USER)

数组格式，需传 user_id。**user_id 不是姓名**。当前 bot 未开通 `contact` 类 MCP 能力，不能通过姓名查询 `userid`；用户未提供明确 `user_id` 时不要写入成员字段。

```json
"负责人": [{"user_id": "zhangsan"}]
```

多个成员：

```json
"负责人": [{"user_id": "zhangsan"}, {"user_id": "lisi"}]
```

### 8. 超链接 (URL)

数组格式，目前仅支持一个链接：

```json
"参考链接": [{"type": "url", "text": "官网", "link": "https://example.com"}]
```

### 9. 图片 (IMAGE)

数组格式：

```json
"封面": [{"image_url": "https://example.com/img.png"}]
```

### 10. 地理位置 (LOCATION)

数组格式：

```json
"地点": [{"source_type": 1, "id": "地点ID", "latitude": "39.9", "longitude": "116.3", "title": "北京"}]
```

## 完整添加记录示例

```json
{
    "docid": "DOCID",
    "sheet_id": "SHEETID",
    "records": [{
        "values": {
            "任务名称": [{"type": "text", "text": "完成需求文档"}],
            "优先级": [{"text": "高"}],
            "截止日期": "2026-03-20",
            "完成进度": 30,
            "已完成": false
        }
    }]
}
```
