#!/bin/bash
# OpenClaw 部署脚本 - 使用环境变量配置

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OpenClaw WeCom 部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 1. 检查 .env 文件
if [ ! -f "${SCRIPT_DIR}/.env" ]; then
    echo -e "${YELLOW}警告: .env 文件不存在${NC}"
    read -p "是否从 .env.example 创建? (y/N): " CREATE_ENV
    if [ "$CREATE_ENV" = "y" ] || [ "$CREATE_ENV" = "Y" ]; then
        cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"
        echo -e "${GREEN}✓ 已创建 .env 文件${NC}"
        echo -e "${YELLOW}请编辑 .env 文件填写实际配置，然后重新运行此脚本${NC}"
        exit 0
    else
        echo -e "${RED}✗ 部署需要 .env 文件${NC}"
        exit 1
    fi
fi

# 2. 加载环境变量 (set -a 确保变量被 export，供 envsubst 使用)
set -a
source "${SCRIPT_DIR}/.env"
set +a

echo -e "${GREEN}1️⃣  检查配置...${NC}"
echo "  数据目录: ${OPENCLAW_DATA_DIR}"
echo "  Gateway 端口: ${GATEWAY_PORT}"
echo "  Docker 镜像: ${OPENCLAW_IMAGE}"
echo ""

# 3. 创建数据目录
echo -e "${GREEN}2️⃣  创建数据目录...${NC}"
if [ ! -d "${OPENCLAW_DATA_DIR}" ]; then
    sudo mkdir -p "${OPENCLAW_DATA_DIR}"
    echo "  ✓ 已创建: ${OPENCLAW_DATA_DIR}"
else
    echo "  ✓ 目录已存在: ${OPENCLAW_DATA_DIR}"
fi

# 4. 设置权限
echo -e "${GREEN}3️⃣  设置目录权限...${NC}"
sudo chown -R ${DOCKER_USER_ID}:${DOCKER_GROUP_ID} "${OPENCLAW_DATA_DIR}"
# 确保 skills 和 bin 目录存在
# 当 OPENCLAW_STATE_DIR=/data/openclaw 时，CONFIG_DIR = /data/openclaw
# Gateway 会自动识别 CONFIG_DIR/skills 下的 managed skills
sudo mkdir -p "${OPENCLAW_DATA_DIR}/skills"
sudo mkdir -p "${OPENCLAW_DATA_DIR}/bin"
sudo chown -R ${DOCKER_USER_ID}:${DOCKER_GROUP_ID} "${OPENCLAW_DATA_DIR}/skills"
sudo chown -R ${DOCKER_USER_ID}:${DOCKER_GROUP_ID} "${OPENCLAW_DATA_DIR}/bin"
echo "  ✓ 权限: ${DOCKER_USER_ID}:${DOCKER_GROUP_ID}"
echo ""

# 5. 检查是否需要初始部署（插件未安装）
PLUGIN_INSTALLED=false
if [ -d "${OPENCLAW_DATA_DIR}/extensions/openclaw-plugin-wecom" ]; then
    PLUGIN_INSTALLED=true
fi

# 6. 生成配置文件
echo -e "${GREEN}4️⃣  配置文件...${NC}"

# 函数：用环境变量替换模板
generate_config() {
    local template=$1
    local output=$2
    
    # 读取模板并替换环境变量
    envsubst < "$template" > "$output"
    chown ${DOCKER_USER_ID}:${DOCKER_GROUP_ID} "$output"
}

# 7. 复制自定义 skills 和 bin
echo -e "${GREEN}5️⃣  复制自定义 Skills 和 Bin...${NC}"
if [ -d "${SCRIPT_DIR}/skills" ]; then
    sudo cp -r "${SCRIPT_DIR}/skills"/* "${OPENCLAW_DATA_DIR}/skills/" 2>/dev/null || true
    sudo chown -R ${DOCKER_USER_ID}:${DOCKER_GROUP_ID} "${OPENCLAW_DATA_DIR}/skills"
    SKILL_COUNT=$(find "${OPENCLAW_DATA_DIR}/skills" -name "SKILL.md" 2>/dev/null | wc -l)
    echo "  ✓ 已复制 ${SKILL_COUNT} 个自定义 skills"
else
    echo "  ℹ 未找到自定义 skills 目录"
fi
if [ -d "${SCRIPT_DIR}/bin" ]; then
    sudo cp -r "${SCRIPT_DIR}/bin"/* "${OPENCLAW_DATA_DIR}/bin/" 2>/dev/null || true
    sudo chmod +x "${OPENCLAW_DATA_DIR}/bin"/*
    sudo chown -R ${DOCKER_USER_ID}:${DOCKER_GROUP_ID} "${OPENCLAW_DATA_DIR}/bin"
    echo "  ✓ 已复制 bin 目录"
else
    echo "  ℹ 未找到 bin 目录"
fi
echo ""

if [ "$PLUGIN_INSTALLED" = true ]; then
    # 插件已安装，使用完整配置
    echo "  插件已安装，使用完整配置..."
    if [ -f "${SCRIPT_DIR}/openclaw.json.template" ]; then
        generate_config "${SCRIPT_DIR}/openclaw.json.template" "${OPENCLAW_DATA_DIR}/openclaw.json"
        echo "  ✓ 已生成完整配置（含 wecom）"
    fi
else
    # 插件未安装，使用基础配置
    echo "  插件未安装，使用基础配置..."
    if [ -f "${SCRIPT_DIR}/openclaw.json.base" ]; then
        generate_config "${SCRIPT_DIR}/openclaw.json.base" "${OPENCLAW_DATA_DIR}/openclaw.json"
        echo "  ✓ 已生成基础配置（不含 wecom）"
    fi
fi
echo ""

# 7. 启动服务
echo -e "${GREEN}6️⃣  启动 Docker 服务...${NC}"
cd "${SCRIPT_DIR}"
docker compose down 2>/dev/null || true
docker compose up -d

echo ""
echo -e "${GREEN}6️⃣  等待服务启动...${NC}"
sleep 8

# 8. 检查服务状态
if docker ps | grep -q openclaw-gateway; then
    echo -e "${GREEN}✓ 服务已启动${NC}"
else
    echo -e "${RED}✗ 服务启动失败${NC}"
    docker compose logs --tail 50
    exit 1
fi
echo ""

# 9. 安装插件（如果未安装）
if [ "$PLUGIN_INSTALLED" = false ]; then
    echo -e "${GREEN}7️⃣  安装企业微信插件...${NC}"
    echo "  正在安装插件..."
    docker exec openclaw-gateway node dist/index.js plugins install openclaw-plugin-wecom
    echo "  ✓ 插件安装完成"
    echo ""
    
    # 10. 更新配置为完整配置
    echo -e "${GREEN}8️⃣  更新配置文件...${NC}"
    if [ -f "${SCRIPT_DIR}/openclaw.json.template" ]; then
        generate_config "${SCRIPT_DIR}/openclaw.json.template" "${OPENCLAW_DATA_DIR}/openclaw.json"
        echo "  ✓ 已更新为完整配置（含 wecom）"
    fi
    echo ""
    
    # 11. 重启服务加载插件和新配置
    echo -e "${GREEN}9️⃣  重启服务以加载插件...${NC}"
    docker compose restart
    sleep 5
    echo "  ✓ 服务已重启"
    echo ""
else
    echo -e "${GREEN}7️⃣  插件检查...${NC}"
    echo "  ✓ 插件已安装，跳过安装步骤"
    echo ""
fi

# 12. 验证
echo -e "${GREEN}🔟  验证部署...${NC}"
docker compose ps
echo ""

# 检查日志确认 wecom 加载
echo "检查 wecom 插件状态..."
if docker logs openclaw-gateway 2>&1 | tail -20 | grep -q "WeCom"; then
    echo -e "${GREEN}✓ WeCom 插件已加载${NC}"
else
    echo -e "${YELLOW}⚠ 未检测到 WeCom 插件日志，请检查配置${NC}"
fi
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "查看日志:"
echo "  docker compose logs -f"
echo ""
echo "查看插件列表:"
echo "  docker exec openclaw-gateway node dist/index.js plugins list"
echo ""
echo "查看配置文件:"
echo "  cat ${OPENCLAW_DATA_DIR}/openclaw.json"
echo ""
echo "Gateway 地址:"
echo "  http://localhost:${GATEWAY_PORT}"
echo ""
