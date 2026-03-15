import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { generateReqId } from "@wecom/aibot-node-sdk";
import { logger } from "../logger.js";

const MCP_GET_CONFIG_CMD = "aibot_get_mcp_config";
const MCP_CONFIG_FETCH_TIMEOUT_MS = 15_000;
const MCP_CONFIG_KEY = "doc";
const DEFAULT_MCP_TRANSPORT = "streamable-http";

let mcpConfigWriteQueue = Promise.resolve();

function withTimeout(promise, timeoutMs, message) {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message ?? `Timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  promise.catch(() => {});

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function getWecomConfigPath() {
  return path.join(os.homedir(), ".openclaw", "wecomConfig", "config.json");
}

function resolveMcpTransport(body = {}) {
  const candidate = String(
    body.transport_type ??
      body.transportType ??
      body.config_type ??
      body.configType ??
      body.type ??
      "",
  )
    .trim()
    .toLowerCase();

  return candidate || DEFAULT_MCP_TRANSPORT;
}

async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFileAtomically(filePath, value) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function fetchMcpConfig(wsClient) {
  if (!wsClient || typeof wsClient.reply !== "function") {
    throw new Error("WS client does not support MCP config requests");
  }

  const reqId = generateReqId("mcp_config");
  const response = await withTimeout(
    wsClient.reply({ headers: { req_id: reqId } }, { biz_type: MCP_CONFIG_KEY }, MCP_GET_CONFIG_CMD),
    MCP_CONFIG_FETCH_TIMEOUT_MS,
    `MCP config fetch timed out after ${MCP_CONFIG_FETCH_TIMEOUT_MS}ms`,
  );

  if (response?.errcode && response.errcode !== 0) {
    throw new Error(`MCP config request failed: errcode=${response.errcode}, errmsg=${response.errmsg ?? "unknown"}`);
  }

  const body = response?.body;
  if (!body?.url) {
    throw new Error("MCP config response missing required 'url' field");
  }

  return {
    key: MCP_CONFIG_KEY,
    type: resolveMcpTransport(body),
    url: body.url,
    isAuthed: body.is_authed,
  };
}

export async function saveMcpConfig(config, runtime) {
  const configPath = getWecomConfigPath();

  const saveTask = mcpConfigWriteQueue.then(async () => {
    const current = await readJsonFile(configPath, {});
    if (!current.mcpConfig || typeof current.mcpConfig !== "object") {
      current.mcpConfig = {};
    }

    current.mcpConfig[config.key || MCP_CONFIG_KEY] = {
      type: config.type,
      url: config.url,
    };

    await writeJsonFileAtomically(configPath, current);
    runtime?.log?.(`[WeCom] MCP config saved to ${configPath}`);
  });

  mcpConfigWriteQueue = saveTask.catch(() => {});
  return saveTask;
}

export async function fetchAndSaveMcpConfig(wsClient, accountId, runtime) {
  try {
    runtime?.log?.(`[${accountId}] Fetching MCP config...`);
    const config = await fetchMcpConfig(wsClient);
    runtime?.log?.(
      `[${accountId}] MCP config fetched: url=${config.url}, type=${config.type}, is_authed=${config.isAuthed ?? "N/A"}`,
    );
    await saveMcpConfig(config, runtime);
  } catch (error) {
    if (typeof wsClient?.reply !== "function") {
      logger.debug?.(`[${accountId}] Skipping MCP config fetch because WS client has no reply() support`);
      return;
    }
    runtime?.error?.(`[${accountId}] Failed to fetch/save MCP config: ${String(error)}`);
  }
}

export const mcpConfigTesting = {
  getWecomConfigPath,
  resolveMcpTransport,
  resetWriteQueue() {
    mcpConfigWriteQueue = Promise.resolve();
  },
};
