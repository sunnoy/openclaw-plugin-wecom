---
name: ones
description: 查询和管理 ONES 项目管理平台的工作项。支持查询 Bug/缺陷、需求、任务，按时间范围过滤，更新工作项状态。使用场景包括"查询我的 Bug"、"最近一个月的缺陷"、"关闭工作项"、"查询项目需求"。
allowed-tools: Bash, Read, Write
---

# ONES 项目管理 Skill

本 Skill 用于与 ONES 项目管理平台交互，支持查询和管理工作项（缺陷、需求、任务等）。

## API 参考文档

完整的 API 文档请参考：[api-reference.md](./api-reference.md)

登录用户名和密码从~/.xyinfpilot/.env获取ONES_USERNAME和ONES_PASSWORD

## 快速参考

### 接口端点

| 用途 | HTTP 方法 | 端点 |
|------|-----------|------|
| 登录 | POST | `/project/api/project/auth/login` |
| GraphQL 查询 | POST | `/project/api/project/team/{team_uuid}/items/graphql` |
| 添加工作项 | POST | `/project/api/project/team/{team_uuid}/tasks/add2` |
| 更新工作项 | POST | `/project/api/project/team/{team_uuid}/tasks/update3` |
| 删除工作项 | POST | `/project/api/project/team/{team_uuid}/tasks/delete` |
| 获取我的项目 | GET | `/project/api/project/team/{team_uuid}/projects/my_project` |

### 请求头

```
Content-Type: application/json
Ones-Auth-Token: {登录返回的 token}
Ones-User-Id: {登录返回的 user.uuid}
```

### 关键字段映射

| UI 显示 | API 字段 | 适用类型 | 说明 |
|--------|---------|---------|------|
| 负责人 | `assign` | 通用 | 工作项负责人 |
| 创建人 | `owner` | 通用 | 工作项创建者 |
| 状态 | `status` | 通用 | 状态对象，含 uuid、name、category |
| 优先级 | `priority` | 通用 | 优先级对象，含 uuid、value |
| 任务类型 | `issueType` | 通用 | 类型对象，含 uuid、name |

### 时间过滤快捷值

```graphql
createTime_range: { quick: "last_30_days" }
deadline_range: { quick: "this_week" }
```

| 快捷值 | 说明 |
|--------|------|
| `today` | 今天 |
| `yesterday` | 昨天 |
| `this_week` | 本周 |
| `last_7_days` | 最近7天 |
| `last_14_days` | 最近14天 |
| `this_month` | 本月 |
| `last_30_days` | 最近30天 |
| `this_quarter` | 本季度 |
| `this_year` | 今年 |

### 状态分类

| category | 说明 |
|----------|------|
| `to_do` | 未开始 |
| `in_progress` | 进行中 |
| `done` | 已完成 |

## 常用查询示例

### 查询我负责的缺陷（最近30天）

```graphql
{
  tasks(
    filter: {
      assign_in: ["{用户UUID}"]
      issueType_in: ["{缺陷类型UUID}"]
      createTime_range: { quick: "last_30_days" }
    }
    orderBy: { createTime: DESC }
  ) {
    uuid
    name
    number
    status { name category }
    priority { value }
    createTime
    deadline
  }
}
```

### 查询项目的需求列表

```graphql
{
  tasks(
    filter: {
      project_in: ["{项目UUID}"]
      issueType_in: ["{需求类型UUID}"]
    }
    orderBy: { number: ASC }
  ) {
    uuid
    name
    number
    status { name category }
    owner { name }
    assign { name }
  }
}
```

### 更新工作项状态

```bash
curl -X POST \
  'https://{host}/project/api/project/team/{teamUUID}/tasks/update3' \
  -H 'Content-Type: application/json' \
  -H 'Ones-Auth-Token: {token}' \
  -H 'Ones-User-Id: {user_uuid}' \
  -d '{
    "tasks": [{
      "uuid": "{任务UUID}",
      "status_uuid": "{新状态UUID}"
    }]
  }'
```

## 使用流程

1. **登录获取认证信息**
   - 调用登录接口获取 `token` 和 `user.uuid`
   - 获取 `teams[].uuid` 作为后续 API 的 `teamUUID`

2. **查询任务类型**
   - 使用 GraphQL 查询 `issueTypes` 获取缺陷/需求/任务的 UUID

3. **执行查询或操作**
   - GraphQL 查询：使用 `/items/graphql` 端点
   - REST 操作：使用对应的 tasks 端点

## 注意事项

- Token 没有过期时间，但用户修改密码、被移出团队或主动登出时会失效
- UUID 生成规则：创建者UUID(8位) + 随机8位字符 = 16位
- `name_match` 模糊搜索应放在 filter 最下面以提高性能
- 更新工作项时部分字段不可修改：`owner`, `create_time`, `number` 等
