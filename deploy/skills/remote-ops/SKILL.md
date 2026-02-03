---
name: remote-ops
description: 通过堡垒机进行远程运维操作。支持两大场景：(1) 服务器操作 - 执行命令、文件传输、日志查看、磁盘检查、查看监控指标等；(2) K8s 操作 - 在 Master 节点执行 kubectl 查看 Pod、日志、进入容器、下载服务日志等。适用于 172/8（私有数据中心）和 10.0.4.0/22（腾讯云内网）网段。使用场景包括"执行远程命令"、"上传下载文件"、"查看 Pod 状态"、"查看镜像版本"、"获取容器日志"、"下载服务日志"、"查看数据库等中间件"、“查看k8s相关监控指标”等。云厂商资源管理请用 cloud-resource skill。
allowed-tools: Bash, Read, AskUserQuestion
---


# 重要

- 不要查看 TOTP 密钥等环境变量，用户应提前配置好

# 服务器操作

```bash
# 脚本帮助
/workspace/bin/jumper.sh -h

# 执行远程命令
/workspace/bin/jumper.sh exec <IP> -- <command>

# 文件下载
/workspace/bin/jumper.sh scp <IP> --download <远程路径> <本地路径>

# 文件上传
/workspace/bin/jumper.sh scp <IP> --upload <本地路径> <远程路径>

# 递归传输目录加 -r 参数
```

## 非k8s服务日志

通过查看服务的进程查找启动参数或者配置文件确定日志位置

# K8s 操作

## 确定 Master 节点

1. 用户明确说查看"5.2qa"或者"5.2dev"环境，使用指定masterip，5.2dev的master ip为10.0.7.244，5.2qa的master ip为10.0.7.180
1. 其他情况需要用户给出环境的 Master IP
2. 若未给出，使用 AskUserQuestion 询问用户

## 执行 kubectl

- 所有 kubectl 命令通过 jumper 在 Master 节点执行
- 重启服务等非只读操作需要通过AskUserQuestion tool询问用户是否执行

```bash
/workspace/bin/jumper.sh exec <MASTER_IP> -- kubectl <子命令>

# 进入容器执行命令
/workspace/bin/jumper.sh exec <master ip> -- "kubectl exec -n default <pod name> -- <command>"

# 重启服务
/workspace/bin/jumper.sh exec <master ip> -- "kubectl rollout restart <resource-type> <resource-name>"

# 容器内执行java
/workspace/bin/jumper.sh exec <master ip> -- "kubectl exec pod -- sh -c '/usr/bin/java -version'"
```

## k8s docker镜像命名规范

完整格式:
```
<registry>/<project>/<service-name>-rpm:<branch>-<iteration>-<commit_date>-<timestamp>-<commit_hash>-<devops_build_time>-<jenkins_build_time>
```

示例:
```
10.0.7.133/private_cloud/private-basic-management-rpm:release-5.2-3.2-20251226-20251218105112-29a14829-1766649568-1766649901
```

| 字段位置 | 字段名称 | 说明 | 示例值 |
|----------|----------|------|--------|
| 1 | branch | 分支名 | release-5.2 |
| 2 | iteration | 所属迭代版本 | 3.2 |
| 3 | commit_date | 代码提交日期 (YYYYMMDD) | 20251226 |
| 4 | timestamp | 时间戳 (YYYYMMDDHHMMSS) | 20251218105112 |
| 5 | commit_hash | Git Commit Hash (前8位) | 29a14829 |
| 6 | devops_build_time | DevOps 构建镜像时间 (Unix) | 1766649568 |
| 7 | jenkins_build_time | Jenkins 构建时间 (Unix) | 1766649901 |


## k8s日志

文件位置

- 非标准输出日志通过hostspath挂载到宿主机，通过kubectl describe pod找出容器内日志目录和宿主机日志目录
- 优先查看非标准输出日志


### 查看日志

通过kubectl进入pod容器内查看以及grep分析日志


### 下载日志


1. 通过 kubectl get pod -o wide 获取 Pod 所在 NODE IP
2. 从该节点的pod挂载的宿主机目录下载日志：
```bash
/workspace/bin/jumper.sh scp <NODE_IP> -r --download <宿主机服务日志路径>/<service>/ ~/Downloads/<service>
```

# 中间件连接

- 中间件包含数据库，redis，kafka，zookeeper，mq等
- 用户查看中间件分为通过服务查看中间件和直接看中间件

## 通过服务查看中间件

- 到业务容器内查找服务渲染后的配置文件，确定加密密码和jasypt配置加密密码和算法
- 容器内解密参考命令
```bash
/usr/lib/jvm/java-8-openjdk-amd64/bin/java -cp "/usr/libra/basic-management/tomcat/webapps/ROOT WEB-INF/lib/*" \
  org.jasypt.intf.cli.JasyptPBEStringDecryptionCLI \
  algorithm=<jasypt algorithm> \
  password=<jasypt password> \
  ivGeneratorClassName=org.jasypt.iv.RandomIvGenerator \
  input=<加密内容，不含ENC()>
```
- 获取中间件实例和连接信息比如数据库名称
- 在中间件pod内连接使用mysql，redis-cli等连接中间件服务
- 连接命令参考

```bash
# 命令参考
/workspace/bin/jumper.sh exec <master ip> -- "kubectl exec -n default <pod name> -- mysql -uprivate_cloud -p'<password>' -e 'DESCRIBE sdk_app_info;' ainemo"
```

## 直接看中间件

- 需要进入java服务容器内获取解密后密码，服务可选basic-management、access
- 找到中间件pod进入容器操作

# 查看监控

- 对于k8s集群，找到n9e服务查询监控指标
