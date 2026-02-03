---
name: gitlab
description: 操作 GitLab 私有化部署平台。支持查询项目、仓库文件、分支，创建/合并 MR，触发 Pipeline。使用场景包括"查询项目列表"、"获取文件内容"、"触发构建"、"创建合并请求"、"查看 Pipeline 状态"。
allowed-tools: Bash, Read, Write
---

# GitLab API Skill

## 登录

access token从~/.xyinfpilot/.env获取GITLAB_ACCESS_TOKEN，使用curl发起请求

## 常用端点

| 用途 | 端点 |
|------|------|
| 项目列表 | `GET /api/v4/projects?membership=true` |
| 文件内容 | `GET /api/v4/projects/:id/repository/files/:path/raw?ref=main` |
| 触发 Pipeline | `POST /api/v4/projects/:id/pipeline` |
| 创建 MR | `POST /api/v4/projects/:id/merge_requests` |
| Pipeline 状态 | `GET /api/v4/projects/:id/pipelines/:pipeline_id` |

## 注意事项

- 文件路径中 `/` 需编码为 `%2F`
- 项目可用数字 ID 或 URL 编码路径（`group%2Fproject`）


