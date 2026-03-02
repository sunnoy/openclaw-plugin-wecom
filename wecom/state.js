import { AsyncLocalStorage } from "node:async_hooks";
import { WEBHOOK_BOT_SEND_URL } from "./constants.js";

const runtimeState = {
  runtime: null,
  openclawConfig: null,
  ensuredDynamicAgentIds: new Set(),
  ensureDynamicAgentWriteQueue: Promise.resolve(),
};

export const dispatchLocks = new Map();
export const messageBuffers = new Map();
export const webhookTargets = new Map();
export const activeStreams = new Map();
export const activeStreamHistory = new Map();
export const streamMeta = new Map();
export const responseUrls = new Map();
export const streamContext = new AsyncLocalStorage();

export function setRuntime(runtime) {
  runtimeState.runtime = runtime;
}

export function getRuntime() {
  if (!runtimeState.runtime) {
    throw new Error("[wecom] Runtime not initialized");
  }
  return runtimeState.runtime;
}

export function setOpenclawConfig(config) {
  // 在设置时统一解析配置中的环境变量占位符 ${VAR}
  runtimeState.openclawConfig = resolveEnvVars(config);
}

export function getOpenclawConfig() {
  return runtimeState.openclawConfig;
}

export function getEnsuredDynamicAgentIds() {
  return runtimeState.ensuredDynamicAgentIds;
}

export function getEnsureDynamicAgentWriteQueue() {
  return runtimeState.ensureDynamicAgentWriteQueue;
}

export function setEnsureDynamicAgentWriteQueue(queuePromise) {
  runtimeState.ensureDynamicAgentWriteQueue = queuePromise;
}

/**
 * 递归替换配置值中的环境变量占位符 ${VAR}
 * - 字符串：替换其中的 ${VAR} 为 process.env.VAR（不存在则保留原样）
 * - 数组：对每一项递归处理
 * - 普通对象：对每个属性递归处理
 */
function resolveEnvVars(value) {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
      return Object.prototype.hasOwnProperty.call(process.env, envVar)
        ? process.env[envVar]
        : match;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvVars(item));
  }

  if (value && typeof value === "object") {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveEnvVars(val);
    }
    return result;
  }

  return value;
}


/**
 * Extract Agent API config from the runtime openclaw config.
 * Returns null when Agent mode is not configured.
 */
export function resolveAgentConfig() {
  const config = getOpenclawConfig();
  const wecom = config?.channels?.wecom;
  const agent = wecom?.agent;

  // setOpenclawConfig 已经做了环境变量解析，这里直接使用解析后的值
  const corpId = agent?.corpId;
  const corpSecret = agent?.corpSecret;
  const agentId = agent?.agentId;

  if (!corpId || !corpSecret || !agentId) return null;
  return {
    corpId,
    corpSecret,
    agentId,
  };
}

/**
 * Resolve a webhook name to a full webhook URL.
 * Supports both full URLs and bare keys in config.
 * Returns null when the webhook name is not configured.
 *
 * @param {string} name - Webhook name from the `to` field (e.g. "ops-group")
 * @returns {string|null}
 */
export function resolveWebhookUrl(name) {
  const config = getOpenclawConfig();
  const webhooks = config?.channels?.wecom?.webhooks;
  if (!webhooks || !webhooks[name]) return null;
  const value = webhooks[name];
  if (value.startsWith("http")) return value;
  return `${WEBHOOK_BOT_SEND_URL}?key=${value}`;
}
