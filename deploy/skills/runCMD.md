# 阿里云

非交互式执行命令 (云助手)

   1 # 1. 提交命令
   2 aliyun ecs RunCommand -p mm --RegionId cn-beijing --InstanceId.1 i-2zedkt0879iyiovsuzea --CommandContent "id" --Type RunShellScript
   3 # 2. 获取结果 (使用返回的 InvokeId)
   4 aliyun ecs DescribeInvocationResults -p mm --RegionId cn-beijing --InvokeId <InvokeId>


# 腾讯云

非交互式执行命令 (tat)

TAT要求命令内容必须进行Base64编码：

  echo -n "your-command-here" | base64

  注意事项：
  - 使用 -n 参数避免换行符
  - 管道符、特殊字符都需要在编码前包含在命令中
  - 例如: echo -n "ls -la /root" | base64

 创建命令配置文件

  创建JSON配置文件（例如：/tmp/tat_command.json）：

  {
    "Content": "<base64-encoded-command>",
    "InstanceIds": ["<instance-id>"],
    "CommandType": "SHELL",
    "Timeout": 60
  }

  参数说明：
  - Content: Base64编码后的命令
  - InstanceIds: 目标实例ID数组
  - CommandType: 命令类型（SHELL/POWERSHELL）
  - Timeout: 超时时间（秒）

```bash
result=$(tccli tat RunCommand --region ap-guangzhou --cli-input-json file:///tmp/tat_command.json) && \
  sleep 2 && \
  invocation_id=$(echo "$result" | grep -o '"InvocationId": "[^"]*"' | cut -d'"' -f4) && \
  tccli tat DescribeInvocations --region ap-guangzhou --InvocationIds "[\"$invocation_id\"]" | \
  grep -o '"InvocationTaskId": "[^"]*"' | cut -d'"' -f4 | \
  xargs -I {} tccli tat DescribeInvocationTasks --region ap-guangzhou --InvocationTaskIds '["{}"]' | \
  grep -o '"Output": "[^"]*"' | cut -d'"' -f4 | base64 -d
```