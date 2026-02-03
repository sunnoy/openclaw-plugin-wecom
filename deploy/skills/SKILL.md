---
name: cloud-resource
description: 管理多云资源（阿里云、腾讯云）。功能包括查询、创建、配置、监控 ECS/CVM 实例、RDS/CDB 数据库、OSS/COS 存储、VPC 网络、SLB/CLB 负载均衡、ACK/TKE 容器集群等资源。使用场景包括"查看实例列表"、"创建数据库"、"查询存储桶"、"配置安全组"、"查看负载均衡"、"批量操作实例"等。
allowed-tools: Bash, Read, Write, AskUserQuestion
hooks:
  PreToolUse:
    - hooks:
        - type: command
          command: "cd ~/.xyinfpilot && git pull"
          once: true
          async: true
---


# 重要

- 不要查看关联的环境变量云厂商配置等隐私信息，用户应该提前配置好

# 云厂商识别

| 云厂商 | CLI 工具 | 默认地域 | 资源前缀示例 |
|--------|----------|----------|--------------|
| 阿里云 | `aliyun` | cn-beijing | ECS, RDS, OSS, SLB, ACK |
| 腾讯云 | `tccli` | ap-beijing | CVM, CDB, COS, CLB, TKE |

# 资源查询

## 阿里云多账号切换

明确指定阿里云账号需要使用 `-p <profile-name>` 参数，比如“查询阿里云mm账号资源”需要使用 `aliyun -p mm`。

## 已知资源类型

直接使用对应服务 API，优先私有 IP 查询。

## 未知资源类型

- **阿里云**: 使用资源中心 `resourcecenter ExecuteSQLQuery` 跨类型查询（全局，无需指定地域）
- **腾讯云**: 按顺序遍历查询：CVM → CLB → CDB → Lighthouse

## 地域查询顺序

用户未指定地域时：
- **阿里云**: cn-beijing → cn-shanghai → cn-hangzhou → cn-shenzhen → 其他
- **腾讯云**: ap-beijing → ap-shanghai → ap-guangzhou → ap-shenzhen → 其他

# CLI使用方式

- 阿里云: `aliyun help` 查看服务列表和操作参数
- 腾讯云: `tccli help` 查看服务列表和操作参数



## 服务器执行shell非交互式命令

参考 runCMD.md

# 复杂场景

批量操作、跨地域统计等场景可临时编写 Python 代码包装 CLI 命令。

# 注意事项

- 涉及删除操作时先向用户确认


