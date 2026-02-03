# ONES GraphQL API 参考文档

> 官方文档：https://docs.ones.cn/project/open-api-doc/graphql/introduction.html

## 概述

ONES GraphQL API 是基于 GraphQL 的查询接口，允许客户端精确获取所需数据。本文档涵盖认证、工作项查询、项目管理等核心功能。

---

## 1. 认证 (Authentication)

### 1.1 用户登录

**URL:**
```
POST https://{host}/project/api/project/auth/login
```

**请求头:**
| Header | 值 | 必填 |
|--------|---|-----|
| Content-Type | application/json | ✅ |

**请求参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| email | string | email/phone 二选一 | 用户邮箱 |
| phone | string | email/phone 二选一 | 用户手机号 |
| password | string | ✅ | 用户密码 |

> 📝 `email` 和 `phone` 同时存在时只有 `email` 生效

**请求体示例:**
```json
{
  "email": "user@example.com",
  "password": "your_password"
}
```

**响应参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| user | object | 用户信息对象 |
| user.uuid | string | 用户唯一标识，用于 `Ones-User-Id` 请求头 |
| user.email | string | 用户邮箱 |
| user.name | string | 用户名称 |
| user.token | string | 认证令牌，用于 `Ones-Auth-Token` 请求头 |
| user.phone | string | 用户手机号 |
| user.avatar | string | 用户头像URL |
| user.status | int | 用户状态 (1=正常) |
| user.license_types | int[] | 许可证类型列表 |
| teams | array | 用户所属团队列表 |
| teams[].uuid | string | 团队UUID，用于API路径中的 `:teamUUID` |
| teams[].name | string | 团队名称 |
| teams[].owner | string | 团队所有者UUID |
| teams[].status | int | 团队状态 |
| teams[].type | string | 团队类型 (free/pro/enterprise) |
| teams[].member_count | int | 团队成员数量 |
| teams[].org_uuid | string | 所属组织UUID |
| org | object | 组织信息 |
| org.uuid | string | 组织UUID |
| org.name | string | 组织名称 |

**响应示例:**
```json
{
  "user": {
    "uuid": "Gq8ZZZ7F",
    "email": "user@example.com",
    "name": "用户名",
    "name_pinyin": "yonghuming",
    "title": "",
    "avatar": "",
    "phone": "",
    "create_time": 1547538969719424,
    "status": 1,
    "channel": "uGq8ZZZ7FflUZ6X5J7pqNlQclsWmkTUD",
    "token": "vBRxnkWypojEA2xxqe92GhhXW3f2FbjC9xZ1A2p7kW0mFhskEwX0wHDpvYZJkpM3",
    "license_types": [1, 2, 3, 4, 5]
  },
  "teams": [
    {
      "uuid": "U66S45tG",
      "status": 1,
      "name": "团队名称",
      "owner": "Gq8ZZZ7F",
      "logo": "",
      "cover_url": "",
      "domain": "",
      "create_time": 1547538969731072,
      "expire_time": -1,
      "type": "pro",
      "member_count": 6,
      "org_uuid": "369VHsHp",
      "workdays": ["Mon", "Tue", "Wed", "Thu", "Fri"],
      "workhours": 800000
    }
  ],
  "org": {
    "uuid": "369VHsHp",
    "name": "组织名称",
    "org_type": 0
  }
}
```

---

## 2. GraphQL 接口

### 2.1 接口说明

**URL:**
```
POST https://{host}/project/api/project/team/{teamUUID}/items/graphql
```

**请求头:**
| Header | 值 | 必填 | 说明 |
|--------|---|-----|------|
| Content-Type | application/json | ✅ | 内容类型 |
| Ones-Auth-Token | {token} | ✅ | 登录返回的token |
| Ones-User-Id | {user_uuid} | ✅ | 登录返回的user.uuid |
| Referer | https://{host} | 推荐 | 来源URL |

**请求体参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| query | string | ✅ | GraphQL 查询语句 |
| variables | object | ❌ | 查询变量，用于动态传参 |
| variables.filter | object | ❌ | 筛选条件 |
| variables.orderBy | object | ❌ | 排序条件 |

**请求体示例:**
```json
{
  "query": "query TASKS($filter: Filter, $orderBy: OrderBy) { tasks(filter: $filter, orderBy: $orderBy) { uuid name } }",
  "variables": {
    "filter": {
      "assign_in": ["用户UUID"]
    },
    "orderBy": {
      "createTime": "DESC"
    }
  }
}
```

**响应参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| data | object | 查询结果数据 |
| data.{queryName} | array/object | 查询的数据内容 |
| errors | array | 错误信息 (仅在出错时) |

---

## 3. 工作项查询 (Tasks)

### 3.1 Task 对象字段

**常用字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 工作项唯一标识 |
| key | string | 工作项key (如 task-xxxxxxx) |
| name | string | 工作项标题 |
| summary | string | 工作项摘要 (同name) |
| number | int | 工作项编号 |
| desc | string | 纯文本描述 |
| desc_rich | string | 富文本描述 (HTML) |
| status | Status | 状态对象 |
| priority | Option | 优先级对象 |
| assign | User | 负责人对象 |
| owner | User | 创建人对象 |
| watchers | [User] | 关注者列表 |
| project | Project | 所属项目 |
| sprint | Sprint | 所属迭代 |
| issueType | IssueType | 任务类型 |
| parent | Task | 父任务 |
| subtasks | [Task] | 子任务列表 |
| createTime | int | 创建时间 (Unix时间戳，微秒) |
| updateTime | int | 更新时间 (Unix时间戳，微秒) |
| deadline | int | 截止日期 (Unix时间戳，秒) |
| estimatedHours | int | 预估工时 |
| remainingManhour | int | 剩余工时 |
| totalManhour | int | 总工时 |
| path | string | 任务路径 |
| position | int | 排序位置 |

**关联对象字段:**

**Status (状态):**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 状态UUID |
| name | string | 状态名称 |
| category | string | 状态分类 (to_do/in_progress/done) |

**User (用户):**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 用户UUID |
| name | string | 用户名称 |
| email | string | 用户邮箱 |
| avatar | string | 用户头像URL |

**Option (选项，如优先级):**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 选项UUID |
| value | string | 选项值/名称 |

**IssueType (任务类型):**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 类型UUID |
| name | string | 类型名称 (需求/缺陷/任务等) |
| icon | string | 图标 |

**Project (项目):**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 项目UUID |
| name | string | 项目名称 |

**Sprint (迭代):**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 迭代UUID |
| name | string | 迭代名称 |

### 3.2 Filter 筛选条件

**通用筛选操作符:**
| 操作符 | 说明 | 示例 |
|--------|------|------|
| `_in` | 包含在列表中 | `assign_in: ["uuid1", "uuid2"]` |
| `_equal` | 等于 | `uuid_equal: "xxx"` |
| `_match` | 模糊匹配 | `name_match: "关键词"` |
| `_range` | 范围 | `createTime_range: { quick: "last_7_days" }` |

**嵌套对象筛选:**
| 操作符 | 说明 | 示例 |
|--------|------|------|
| `{object}: { uuid_in: [] }` | 对象UUID匹配 | `status: { uuid_in: ["xxx"] }` |
| `{object}: { category_in: [] }` | 对象分类匹配 | `status: { category_in: ["to_do"] }` |

**时间范围快捷值:**
| 值 | 说明 |
|---|---|
| `today` | 今天 |
| `yesterday` | 昨天 |
| `this_week` | 本周 |
| `last_7_days` | 最近7天 |
| `last_14_days` | 最近14天 |
| `this_month` | 本月 |
| `last_30_days` | 最近30天 |
| `this_quarter` | 本季度 |
| `this_year` | 今年 |

### 3.3 基础查询 - 获取任务列表

**GraphQL:**
```graphql
{
  tasks(
    filter: {
      project_in: ["项目UUID"]
    }
    orderBy: {
      createTime: DESC
    }
  ) {
    uuid
    name
    number
    summary
    desc
    status { uuid name category }
    priority { uuid value }
    assign { uuid name email }
    owner { uuid name }
    createTime
    deadline
    issueType { uuid name }
    project { uuid name }
    sprint { uuid name }
  }
}
```

**响应示例:**
```json
{
  "data": {
    "tasks": [
      {
        "uuid": "DU6krHBNNKSnnHNj",
        "name": "修复登录页面Bug",
        "number": 44,
        "summary": "修复登录页面Bug",
        "desc": "登录页面在IE浏览器下显示异常",
        "status": {
          "uuid": "4HfKoazf",
          "name": "待处理",
          "category": "to_do"
        },
        "priority": {
          "uuid": "7tKAV46c",
          "value": "高"
        },
        "assign": {
          "uuid": "DU6krHBN",
          "name": "张三",
          "email": "zhangsan@example.com"
        },
        "owner": {
          "uuid": "DU6krHBN",
          "name": "张三"
        },
        "createTime": 1566182532175312,
        "deadline": 1567296000,
        "issueType": {
          "uuid": "GLLfcQxq",
          "name": "缺陷"
        },
        "project": {
          "uuid": "DU6krHBNXuPAbpv8",
          "name": "产品开发项目"
        },
        "sprint": {
          "uuid": "3XX1trc1",
          "name": "Sprint 1"
        }
      }
    ]
  }
}
```

### 3.4 按负责人筛选

```graphql
{
  tasks(filter: { assign_in: ["用户UUID"] }) {
    uuid
    name
    assign { uuid name }
    status { uuid name category }
  }
}
```

### 3.5 按创建人筛选

```graphql
{
  tasks(filter: { owner_in: ["用户UUID"] }) {
    uuid
    name
    owner { uuid name }
  }
}
```

### 3.6 按任务类型筛选 (缺陷/需求/任务)

```graphql
{
  tasks(filter: { issueType_in: ["任务类型UUID"] }) {
    uuid
    name
    issueType { uuid name }
  }
}
```

### 3.7 按状态筛选

```graphql
{
  tasks(
    filter: {
      status: { uuid_in: ["状态UUID"] }
    }
  ) {
    uuid
    name
    status { uuid name category }
  }
}
```

**按状态分类筛选:**
```graphql
{
  tasks(
    filter: {
      status: { category_in: ["to_do", "in_progress"] }
    }
  ) {
    uuid
    name
    status { uuid name category }
  }
}
```

### 3.8 按创建时间筛选

**方法1 - 使用快捷时间范围:**
```graphql
{
  tasks(
    filter: {
      createTime_range: { quick: "last_30_days" }
    }
  ) {
    uuid
    name
    createTime
  }
}
```

**方法2 - 使用日期范围:**
```graphql
{
  tasks(
    filter: {
      createTime_range: {
        from: "2024-01-01",
        to: "2024-12-31"
      }
    }
  ) {
    uuid
    name
    createTime
  }
}
```

### 3.9 按截止日期筛选

```graphql
{
  tasks(
    filter: {
      deadline_range: { quick: "this_week" }
    }
  ) {
    uuid
    name
    deadline
  }
}
```

### 3.10 按标题模糊搜索

```graphql
{
  tasks(
    filter: {
      name_match: "搜索关键词"
    }
  ) {
    uuid
    name
  }
}
```

> ⚠️ `name_match` 应放在 filter 条件的最下面以提高筛选性能

### 3.11 按迭代筛选

```graphql
{
  tasks(filter: { sprint_in: ["迭代UUID"] }) {
    uuid
    name
    sprint { uuid name }
  }
}
```

### 3.12 组合筛选示例

```graphql
{
  tasks(
    filter: {
      project_in: ["项目UUID"]
      assign_in: ["用户UUID"]
      issueType_in: ["缺陷类型UUID"]
      status: { category_in: ["to_do", "in_progress"] }
      createTime_range: { quick: "last_30_days" }
    }
    orderBy: { createTime: DESC }
  ) {
    uuid
    name
    number
    summary
    status { uuid name category }
    priority { uuid value }
    assign { uuid name }
    owner { uuid name }
    createTime
    deadline
  }
}
```

---

## 4. 分页查询

### 4.1 使用 buckets 分页

**请求:**
```graphql
{
  buckets(
    groupBy: { tasks: {} }
    pagination: {
      first: 10
      after: "游标值"
      preciseCount: false
    }
  ) {
    key
    pageInfo {
      count
      totalCount
      startCursor
      endCursor
      hasNextPage
      unstable
    }
    tasks(
      filter: { project_in: ["项目UUID"] }
      orderBy: { number: ASC }
    ) {
      uuid
      number
      name
    }
  }
}
```

**Pagination 参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| first | int | 向后翻页获取的数量 (默认0) |
| after | string | 向后翻页的游标 (空字符串=从头开始) |
| last | int | 向前翻页获取的数量 (默认0) |
| before | string | 向前翻页的游标 (空字符串=从末尾开始) |
| limit | int | 获取数量 (可替代first/last) |
| preciseCount | boolean | 是否返回精确总数 (false更快但不精确) |

**PageInfo 响应字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| count | int | 当前页数据条数 |
| totalCount | int | 总数据条数 |
| startCursor | string | 当前页起始游标 |
| endCursor | string | 当前页结束游标 |
| hasNextPage | boolean | 是否有下一页 |
| unstable | boolean | 数据是否不稳定 |

**响应示例:**
```json
{
  "data": {
    "buckets": [
      {
        "key": "bucket.0.__all",
        "pageInfo": {
          "count": 10,
          "totalCount": 177,
          "startCursor": "70bbN1HY6ZkKAAAAdGFzay1HQXk2dUwzbVhTY0o0SmRq",
          "endCursor": "70bbN1HY6ZkTAAAAdGFzay1HQXk2dUwzbUVadHZlS1Vu",
          "hasNextPage": true,
          "unstable": false
        },
        "tasks": [
          { "number": 11, "uuid": "GAy6uL3mXScJ4Jdj", "name": "任务1" },
          { "number": 12, "uuid": "GAy6uL3mTy9xJ656", "name": "任务2" }
        ]
      }
    ]
  }
}
```

---

## 5. 项目查询 (Projects)

### 5.1 获取所有产品 (GraphQL)

```graphql
{
  products(orderBy: { createTime: DESC }) {
    uuid
    name
    key
    owner { uuid name }
    assign { uuid name }
    createTime
    taskCount
    taskCountToDo
    taskCountInProgress
    taskCountDone
  }
}
```

**Product 字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 产品UUID |
| name | string | 产品名称 |
| key | string | 产品key |
| owner | User | 创建者 |
| assign | User | 负责人 |
| createTime | int | 创建时间 |
| taskCount | int | 总任务数 |
| taskCountToDo | int | 待处理任务数 |
| taskCountInProgress | int | 进行中任务数 |
| taskCountDone | int | 已完成任务数 |

### 5.2 获取当前用户项目列表 (REST API)

**URL:**
```
GET https://{host}/project/api/project/team/{teamUUID}/projects/my_project
```

**请求头:**
| Header | 值 | 必填 |
|--------|---|-----|
| Content-Type | application/json | ✅ |
| Ones-Auth-Token | {token} | ✅ |
| Ones-User-Id | {user_uuid} | ✅ |
| Referer | https://{host} | 推荐 |

**响应参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| projects | array | 项目列表 |
| projects[].uuid | string | 项目UUID |
| projects[].name | string | 项目名称 |
| projects[].assign | string | 负责人UUID |
| projects[].status_uuid | string | 状态UUID |
| projects[].status_category | string | 状态分类 |
| projects[].announcement | string | 项目公告 |
| projects[].deadline | int | 截止日期 |
| projects[].is_pin | boolean | 是否置顶 |
| projects[].status | int | 项目状态 (1=正常) |
| projects[].task_update_time | int | 任务最后更新时间 |
| projects[].program_uuid | string | 所属项目集UUID |
| archive_projects | array | 归档项目列表 |
| server_update_stamp | int | 服务器更新时间戳 |

**响应示例:**
```json
{
  "projects": [
    {
      "uuid": "DU6krHBNRJ8sVGyN",
      "name": "产品开发项目",
      "assign": "DU6krHBN",
      "status_uuid": "to_do",
      "status_category": "to_do",
      "announcement": "",
      "deadline": 0,
      "is_pin": false,
      "status": 1,
      "is_open_email_notify": false,
      "task_update_time": 1565863546,
      "program_uuid": ""
    }
  ],
  "archive_projects": [],
  "server_update_stamp": 1566200426835856
}
```

---

## 6. 任务类型查询 (Issue Types)

### 6.1 获取项目的任务类型

```graphql
{
  issueTypes(
    filter: {
      projects: { uuid_in: ["项目UUID"] }
    }
  ) {
    uuid
    name
    icon
  }
}
```

**响应示例:**
```json
{
  "data": {
    "issueTypes": [
      { "uuid": "GLLfcQxq", "name": "需求", "icon": "requirement" },
      { "uuid": "4sBPV4Eh", "name": "缺陷", "icon": "bug" },
      { "uuid": "3D2UjSN6", "name": "任务", "icon": "task" }
    ]
  }
}
```

### 6.2 获取子任务类型

```graphql
{
  issueTypes(
    filter: {
      projects: { uuid_in: ["项目UUID"] }
      subIssueType_in: [true]
    }
  ) {
    uuid
    name
  }
}
```

---

## 7. 工作项操作 (REST API)

### 7.1 添加工作项

**URL:**
```
POST https://{host}/project/api/project/team/{teamUUID}/tasks/add2
```

**请求头:**
| Header | 值 | 必填 |
|--------|---|-----|
| Content-Type | application/json | ✅ |
| Ones-Auth-Token | {token} | ✅ |
| Ones-User-Id | {user_uuid} | ✅ |
| Referer | https://{host} | 推荐 |

**调用权限:** `create_tasks`

**请求参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| tasks | array | ✅ | 要创建的工作项列表 |
| tasks[].uuid | string | ✅ | 工作项UUID (创建者uuid + 随机8位字符) |
| tasks[].owner | string | ✅ | 创建者UUID |
| tasks[].assign | string | ✅ | 负责人UUID |
| tasks[].summary | string | ✅ | 任务标题 |
| tasks[].project_uuid | string | ✅ | 项目UUID |
| tasks[].issue_type_uuid | string | ✅ | 任务类型UUID |
| tasks[].parent_uuid | string | ❌ | 父任务UUID (创建子任务时) |
| tasks[].desc_rich | string | ❌ | 富文本描述 (HTML格式) |
| tasks[].priority | string | ❌ | 优先级UUID |
| tasks[].deadline | int | ❌ | 截止日期 (Unix时间戳，秒) |
| tasks[].sprint_uuid | string | ❌ | 迭代UUID |
| tasks[].field_values | array | ❌ | 自定义属性值列表 |

> 📝 **UUID生成规则:** 创建者UUID(8位) + 随机8位字符 = 16位

**请求体示例:**
```json
{
  "tasks": [
    {
      "uuid": "DU6krHBNNKSnnHNj",
      "owner": "DU6krHBN",
      "assign": "DU6krHBN",
      "summary": "新建任务标题",
      "parent_uuid": "",
      "project_uuid": "DU6krHBNXuPAbpv8",
      "issue_type_uuid": "GLLfcQxq",
      "desc_rich": "<p>任务描述内容</p>",
      "priority": "7tKAV46c",
      "field_values": []
    }
  ]
}
```

**响应参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| tasks | array | 创建成功的工作项列表 |
| tasks[].uuid | string | 工作项UUID |
| tasks[].number | int | 工作项编号 |
| tasks[].status | int | 状态 (1=正常) |
| tasks[].status_uuid | string | 状态UUID |
| tasks[].create_time | int | 创建时间 (微秒) |
| tasks[].server_update_stamp | int | 服务器更新时间戳 |
| tasks[].field_values | array | 属性值列表 |
| tasks[].watchers | array | 关注者UUID列表 |
| bad_tasks | array | 创建失败的任务列表 |

**响应示例:**
```json
{
  "tasks": [
    {
      "uuid": "DU6krHBNNKSnnHNj",
      "owner": "DU6krHBN",
      "assign": "DU6krHBN",
      "tags": "",
      "sprint_uuid": null,
      "project_uuid": "DU6krHBNXuPAbpv8",
      "issue_type_uuid": "GLLfcQxq",
      "sub_issue_type_uuid": "",
      "status_uuid": "4HfKoazf",
      "create_time": 1566182532175312,
      "deadline": null,
      "status": 1,
      "summary": "新建任务标题",
      "desc": "任务描述内容",
      "desc_rich": "<p>任务描述内容</p>",
      "parent_uuid": "",
      "position": 0,
      "number": 44,
      "priority": "7tKAV46c",
      "assess_manhour": 0,
      "total_manhour": 0,
      "remaining_manhour": null,
      "watchers": ["DU6krHBN"],
      "field_values": [
        {
          "field_uuid": "field001",
          "type": 2,
          "value": "新建任务标题",
          "value_type": 0
        }
      ],
      "server_update_stamp": 1566182532300576,
      "subtasks": [],
      "path": "DU6krHBNNKSnnHNj"
    }
  ],
  "bad_tasks": []
}
```

### 7.2 更新工作项

**URL:**
```
POST https://{host}/project/api/project/team/{teamUUID}/tasks/update3
```

> 📝 `update2` 用于手机App，`update3` 用于Web端（速度更快）

**调用权限:** `update_tasks`

**请求参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| tasks | array | ✅ | 要更新的工作项列表 |
| tasks[].uuid | string | ✅ | 工作项UUID |
| tasks[].summary | string | ❌ | 标题 |
| tasks[].desc_rich | string | ❌ | 富文本描述 |
| tasks[].assign | string | ❌ | 负责人UUID |
| tasks[].status_uuid | string | ❌ | 状态UUID |
| tasks[].priority | string | ❌ | 优先级UUID |
| tasks[].deadline | int | ❌ | 截止日期 (Unix时间戳，秒) |
| tasks[].sprint_uuid | string | ❌ | 迭代UUID |
| tasks[].field_values | array | ❌ | 自定义属性值列表 |

**不可更新字段:**
`watchers`, `owner`, `create_time`, `update_time`, `number`, `total_manhour`, `assess_manhour`, `remaining_manhour`, `estimate_variance`, `time_progress`

**请求体示例:**
```json
{
  "tasks": [
    {
      "uuid": "DU6krHBNNKSnnHNI",
      "status_uuid": "newStatusUUID",
      "assign": "newAssignUUID",
      "desc_rich": "<p>更新后的描述内容</p>"
    }
  ]
}
```

**响应参数:** 同添加工作项

### 7.3 删除工作项

**URL:**
```
POST https://{host}/project/api/project/team/{teamUUID}/tasks/delete
```

**调用权限:** `delete_tasks`

**请求参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| tasks | array | ✅ | 要删除的任务UUID列表 |

**请求体示例:**
```json
{
  "tasks": ["DU6krHBNNKSnnHNj"]
}
```

**响应示例:**
```json
{
  "server_update_stamp": 1566200426835856
}
```

---

## 8. 属性查询 (Fields)

### 8.1 获取工作项属性定义

```graphql
{
  fields(
    filter: {
      pool_in: ["task"],
      context: { type_equal: "team" }
    }
  ) {
    uuid
    name
    fieldType
    allowEmpty
    required
    builtIn
    defaultValue
    aliases
  }
}
```

**Field 响应字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| uuid | string | 属性UUID |
| name | string | 属性显示名称 |
| fieldType | string | 属性类型 (text/status/option等) |
| allowEmpty | boolean | 是否允许为空 |
| required | boolean | 是否必填 |
| builtIn | boolean | 是否为固有属性 |
| defaultValue | any | 默认值 |
| aliases | string[] | 属性别名列表 |

**响应示例:**
```json
{
  "data": {
    "fields": [
      {
        "aliases": ["uuid"],
        "allowEmpty": false,
        "builtIn": true,
        "defaultValue": null,
        "fieldType": "text",
        "name": "[UUID]",
        "required": false,
        "uuid": null
      },
      {
        "aliases": ["status"],
        "allowEmpty": false,
        "builtIn": false,
        "defaultValue": null,
        "fieldType": "status",
        "name": "任务状态",
        "required": false,
        "uuid": "field_status_uuid"
      }
    ]
  }
}
```

**属性筛选语法:**
| builtIn | 语法格式 | 示例 |
|---------|----------|------|
| `true` | `field_operand` | `assign_in: [...]` |
| `false` | `_field_operand` | `_LNCtECAx_in: [...]` |

---

## 9. 工时操作 (Manhour)

### 9.1 添加工时 (GraphQL Mutation)

```graphql
mutation {
  addManhour(
    task: "{任务UUID}"
    hours: 100000
    start_time: 1598966836
    type: estimated
    description: "工作内容描述"
    owner: "{用户UUID}"
    hours_format: "avg"
  ) {
    key
    hours
    type
    description
    startTime
    owner { uuid name }
    task { key name }
  }
}
```

**请求参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| task | string | ✅ | 任务UUID |
| hours | int | ✅ | 工时 (毫秒) |
| start_time | int | ✅ | 开始时间 (Unix时间戳，秒) |
| type | enum | ✅ | 工时类型: estimated(预估)/recorded(登记) |
| description | string | ❌ | 工作内容描述 |
| owner | string | ✅ | 工时记录者UUID |
| hours_format | string | ❌ | 工时格式 |

### 9.2 查询工时

```graphql
query {
  manhours(
    filter: {
      owner_in: ["{用户UUID}"],
      task_in: ["{任务UUID}"]
    }
    orderBy: {
      createTime: DESC,
      startTime: DESC
    }
  ) {
    key
    hours
    startTime
    description
    type
    owner { uuid name avatar }
  }
}
```

**Manhour 响应字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| key | string | 工时记录key |
| hours | int | 工时 (毫秒) |
| startTime | int | 开始时间 |
| description | string | 描述 |
| type | string | 类型 (estimated/recorded) |
| owner | User | 记录者 |

### 9.3 修改工时

```graphql
mutation {
  updateManhour(
    key: "manhour-2CjkDZto"
    hours: 2000000
  ) {
    key
    hours
    type
    owner { uuid name }
  }
}
```

### 9.4 删除工时

```graphql
mutation {
  deleteManhour(key: "manhour-BEA9LMgd") {
    key
  }
}
```

---

## 10. 常用状态分类

| category | 说明 | 常见状态名 |
|----------|------|-----------|
| `to_do` | 未开始 | 待处理、待开发、待评审 |
| `in_progress` | 进行中 | 开发中、测试中、修复中 |
| `done` | 已完成 | 已完成、已关闭、已验收 |

---

## 11. 错误处理

### 11.1 常见错误码

| HTTP状态码 | errcode | 说明 |
|------------|---------|------|
| 200 | - | 成功 |
| 401 | Unauthorized | Token无效或过期 |
| 403 | Forbidden | 无权限访问 |
| 500 | ServerError | GraphQL语法错误或参数不匹配 |
| 813 | - | 账号过期 |

### 11.2 错误响应格式

```json
{
  "code": 500,
  "errcode": "ServerError",
  "type": "ServerError"
}
```

### 11.3 账号过期响应

```json
{
  "is_owner": true,
  "expire_time": 1578053867,
  "csm": {
    "email": "support@ones.ai",
    "name": "客服",
    "title": "客户成功经理",
    "phone": "400-xxx-xxxx"
  }
}
```

---

## 12. 完整调用示例

### 12.1 cURL 示例 - 查询我负责的缺陷

```bash
curl -X POST \
  'https://ones.example.com/project/api/project/team/{teamUUID}/items/graphql' \
  -H 'Content-Type: application/json' \
  -H 'Ones-Auth-Token: {token}' \
  -H 'Ones-User-Id: {user_uuid}' \
  -d '{
    "query": "{ tasks(filter: { assign_in: [\"{user_uuid}\"], issueType_in: [\"{缺陷类型UUID}\"], createTime_range: { quick: \"last_30_days\" } }, orderBy: { createTime: DESC }) { uuid name number status { name category } priority { value } createTime deadline } }"
  }'
```

### 12.2 Shell 脚本示例

```bash
#!/bin/bash
ONES_HOST="https://ones.example.com"
TEAM_UUID="your_team_uuid"
TOKEN="your_token"
USER_UUID="your_user_uuid"

# GraphQL 查询
QUERY='{ tasks(filter: { assign_in: ["'$USER_UUID'"] }, orderBy: { createTime: DESC }) { uuid name number status { name category } priority { value } } }'

curl -s -X POST \
  "${ONES_HOST}/project/api/project/team/${TEAM_UUID}/items/graphql" \
  -H "Content-Type: application/json" \
  -H "Ones-Auth-Token: ${TOKEN}" \
  -H "Ones-User-Id: ${USER_UUID}" \
  -d "{\"query\": \"$QUERY\"}" | jq .
```

---

## 参考链接

- [GraphQL 官方文档](https://docs.ones.cn/project/open-api-doc/graphql/introduction.html)
- [GraphQL Schema 定义](https://docs.ones.cn/project/open-api-doc/graphql/schema.html)
- [GraphQL 示例](https://docs.ones.cn/project/open-api-doc/graphql/example.html)
- [认证 API](https://docs.ones.cn/project/open-api-doc/auth/auth.html)
- [工作项 API](https://docs.ones.cn/project/open-api-doc/project/task.html)
- [项目 API](https://docs.ones.cn/project/open-api-doc/project/project.html)
