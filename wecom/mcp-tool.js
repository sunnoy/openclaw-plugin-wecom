import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateReqId } from "@wecom/aibot-node-sdk";
import { logger } from "../logger.js";
import { listAccountIds, resolveAccount, resolveDefaultAccountId } from "./accounts.js";
import { detectMime } from "./openclaw-compat.js";
import { getOpenclawConfig, getRuntime, streamContext } from "./state.js";
import { getWsClient } from "./ws-state.js";

const MCP_GET_CONFIG_CMD = "aibot_get_mcp_config";
const AIBOT_SEND_BIZ_MSG_CMD = "aibot_send_biz_msg";
const MCP_CONFIG_FETCH_TIMEOUT_MS = 15_000;
const HTTP_REQUEST_TIMEOUT_MS = 30_000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 120_000;
const BIZ_MSG_SEND_TIMEOUT_MS = 10_000;
const UNSUPPORTED_BIZ_TYPE_ERRCODE = 846609;
const OFFICIAL_WECOM_PLUGIN_VERSION = "2026.4.23";
const WECOM_USERID_HEADER = "x-openclaw-wecom-userid";
const DOC_AUTH_ERROR_CODES = new Set([851013, 851014, 851008]);
const DOC_AUTH_BIZ_TYPE = 1;
const DOC_AUTH_CHAT_TYPE_SINGLE = 1;
const DOC_AUTH_CHAT_TYPE_GROUP = 2;
const SMARTPAGE_CREATE_SINGLE_FILE_MAX_BYTES = 10 * 1024 * 1024;
const SMARTPAGE_CREATE_TOTAL_FILE_MAX_BYTES = 20 * 1024 * 1024;
const INBOUND_MCP_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

const CACHE_CLEAR_ERROR_CODES = new Set([-32001, -32002, -32003]);
const BIZ_CACHE_CLEAR_ERROR_CODES = new Set([850001, 850002, 851014]);
const GEMINI_UNSUPPORTED_KEYWORDS = new Set([
  "patternProperties",
  "additionalProperties",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "examples",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

const mcpConfigCache = new Map();
const mcpSessionCache = new Map();
const statelessSessions = new Set();
const inflightInitRequests = new Map();

class McpRpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "McpRpcError";
  }
}

class McpHttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "McpHttpError";
  }
}

function createErrcodeError(errcode, errmsg, extra = {}) {
  const error = new Error(errmsg ?? `Error code: ${errcode}`);
  error.errcode = errcode;
  error.errmsg = errmsg;
  Object.assign(error, extra);
  return error;
}

function normalizeUnsupportedBizTypePayload(payload, category) {
  const errcode = Number(payload?.errcode);
  const rawMessage =
    typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.errmsg === "string"
        ? payload.errmsg
        : "";
  if (errcode !== UNSUPPORTED_BIZ_TYPE_ERRCODE && !/unsupported mcp biz type/i.test(rawMessage)) {
    return payload;
  }

  return {
    error: `WeCom MCP category "${category}" is not enabled for the current bot/runtime.`,
    errcode: UNSUPPORTED_BIZ_TYPE_ERRCODE,
    category,
    unsupportedCategory: true,
    details:
      rawMessage ||
      `unsupported mcp biz type for category "${category}"`,
    note:
      category !== "doc"
        ? `Per WeCom official policy, enterprises with >10 people only have access to the "doc" category. ` +
          `Categories like contact, todo, meeting, schedule, msg are only available for small teams (<=10 people).`
        : undefined,
    next_action:
      `Stop retrying category "${category}" with alternate read/list/find paths. ` +
      `Do NOT attempt other categories as a workaround. ` +
      `Inform the user that the "${category}" MCP category is not available for their current bot/enterprise.`,
  };
}

function normalizeBizResult(category, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  return normalizeUnsupportedBizTypePayload(result, category);
}

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

function buildCacheKey(accountId, category) {
  return `${accountId}:${category}`;
}

function resolveCurrentAccountId() {
  const contextualAccountId = streamContext.getStore()?.accountId;
  if (contextualAccountId) {
    return contextualAccountId;
  }

  const cfg = getOpenclawConfig();
  const defaultAccountId = resolveDefaultAccountId(cfg);
  if (isMcpCapableAccount(cfg, defaultAccountId)) {
    return defaultAccountId;
  }

  for (const accountId of listAccountIds(cfg)) {
    if (accountId !== defaultAccountId && isMcpCapableAccount(cfg, accountId)) {
      return accountId;
    }
  }

  return defaultAccountId;
}

function isMcpCapableAccount(cfg, accountId) {
  const account = resolveAccount(cfg, accountId);
  return Boolean(account?.enabled !== false && account?.configured);
}

function normalizeOptionalString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

function getConnectedWsClient(accountId) {
  const wsClient = getWsClient(accountId);
  if (!wsClient?.isConnected) {
    throw new Error(`WS client is not connected for account ${accountId}`);
  }
  return wsClient;
}

async function fetchMcpConfig(accountId, category) {
  const wsClient = getConnectedWsClient(accountId);
  const reqId = generateReqId("mcp_config");
  const response = await withTimeout(
    wsClient.reply(
      { headers: { req_id: reqId } },
      { biz_type: category, plugin_version: OFFICIAL_WECOM_PLUGIN_VERSION },
      MCP_GET_CONFIG_CMD,
    ),
    MCP_CONFIG_FETCH_TIMEOUT_MS,
    `MCP config fetch for "${category}" timed out after ${MCP_CONFIG_FETCH_TIMEOUT_MS}ms`,
  );

  if (response?.errcode !== undefined && response.errcode !== 0) {
    throw createErrcodeError(
      response.errcode,
      response.errmsg ?? `MCP config request failed for category "${category}"`,
      { category },
    );
  }

  const body = response?.body;
  if (!body?.url) {
    throw new Error(`MCP config response missing url field for category "${category}"`);
  }

  return body;
}

async function getMcpConfig(accountId, category) {
  const key = buildCacheKey(accountId, category);
  const cached = mcpConfigCache.get(key);
  if (cached) {
    return cached;
  }

  const config = await fetchMcpConfig(accountId, category);
  mcpConfigCache.set(key, config);
  return config;
}

async function getMcpUrl(accountId, category) {
  const config = await getMcpConfig(accountId, category);
  return config.url;
}

async function sendRawJsonRpc(url, session, body, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (session.sessionId) {
    headers["Mcp-Session-Id"] = session.sessionId;
  }
  const requesterUserId = String(options.requesterUserId ?? "").trim();
  if (requesterUserId) {
    headers[WECOM_USERID_HEADER] = requesterUserId;
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`MCP request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`MCP network request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const newSessionId = response.headers.get("mcp-session-id");
  if (!response.ok) {
    throw new McpHttpError(response.status, `MCP HTTP request failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  if (response.status === 204 || contentLength === "0") {
    return { rpcResult: undefined, newSessionId };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return {
      rpcResult: await parseSseResponse(response),
      newSessionId,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return { rpcResult: undefined, newSessionId };
  }

  const rpc = JSON.parse(text);
  if (rpc.error) {
    throw new McpRpcError(rpc.error.code, `MCP RPC error [${rpc.error.code}]: ${rpc.error.message}`, rpc.error.data);
  }

  return { rpcResult: rpc.result, newSessionId };
}

async function initializeSession(accountId, category, url, options = {}) {
  const session = { sessionId: null, initialized: false, stateless: false };
  const initializeBody = {
    jsonrpc: "2.0",
    id: generateReqId("mcp_init"),
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "wecom_mcp", version: "1.0.0" },
    },
  };

  const { newSessionId: initSessionId } = await sendRawJsonRpc(url, session, initializeBody, options);
  if (initSessionId) {
    session.sessionId = initSessionId;
  }

  const key = buildCacheKey(accountId, category);
  if (!session.sessionId) {
    session.stateless = true;
    session.initialized = true;
    statelessSessions.add(key);
    mcpSessionCache.set(key, session);
    return session;
  }

  const { newSessionId: notifySessionId } = await sendRawJsonRpc(
    url,
    session,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    options,
  );

  if (notifySessionId) {
    session.sessionId = notifySessionId;
  }

  session.initialized = true;
  mcpSessionCache.set(key, session);
  return session;
}

async function getOrCreateSession(accountId, category, url, options = {}) {
  const key = buildCacheKey(accountId, category);
  if (statelessSessions.has(key)) {
    const cached = mcpSessionCache.get(key);
    if (cached) {
      return cached;
    }
  }

  const cached = mcpSessionCache.get(key);
  if (cached?.initialized) {
    return cached;
  }

  const inflight = inflightInitRequests.get(key);
  if (inflight) {
    return inflight;
  }

  const request = initializeSession(accountId, category, url, options).finally(() => {
    inflightInitRequests.delete(key);
  });
  inflightInitRequests.set(key, request);
  return request;
}

async function rebuildSession(accountId, category, url, options = {}) {
  const key = buildCacheKey(accountId, category);
  const inflight = inflightInitRequests.get(key);
  if (inflight) {
    return inflight;
  }

  const request = initializeSession(accountId, category, url, options).finally(() => {
    inflightInitRequests.delete(key);
  });
  inflightInitRequests.set(key, request);
  return request;
}

function clearCategoryCache(accountId, category) {
  const key = buildCacheKey(accountId, category);
  mcpConfigCache.delete(key);
  mcpSessionCache.delete(key);
  statelessSessions.delete(key);
  inflightInitRequests.delete(key);
}

async function sendJsonRpc(accountId, category, method, params, options = {}) {
  const url = await getMcpUrl(accountId, category);
  const body = {
    jsonrpc: "2.0",
    id: generateReqId("mcp_rpc"),
    method,
    ...(params !== undefined ? { params } : {}),
  };

  let session = await getOrCreateSession(accountId, category, url, options);
  try {
    const { rpcResult, newSessionId } = await sendRawJsonRpc(url, session, body, options);
    if (newSessionId) {
      session.sessionId = newSessionId;
    }
    return rpcResult;
  } catch (error) {
    if (error instanceof McpRpcError && CACHE_CLEAR_ERROR_CODES.has(error.code)) {
      clearCategoryCache(accountId, category);
    }

    if (session.stateless) {
      throw error;
    }

    if (error instanceof McpHttpError && error.statusCode === 404) {
      const key = buildCacheKey(accountId, category);
      mcpSessionCache.delete(key);
      session = await rebuildSession(accountId, category, url, options);
      const { rpcResult, newSessionId } = await sendRawJsonRpc(url, session, body, options);
      if (newSessionId) {
        session.sessionId = newSessionId;
      }
      return rpcResult;
    }

    logger.error(`[wecom_mcp] RPC failed for ${accountId}/${category}/${method}: ${error.message}`);
    throw error;
  }
}

async function parseSseResponse(response) {
  const text = await response.text();
  const lines = text.split("\n");
  let currentDataParts = [];
  let lastEventData = "";

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      currentDataParts.push(line.slice(6));
      continue;
    }
    if (line.startsWith("data:")) {
      currentDataParts.push(line.slice(5));
      continue;
    }
    if (line.trim() === "" && currentDataParts.length > 0) {
      lastEventData = currentDataParts.join("\n").trim();
      currentDataParts = [];
    }
  }

  if (currentDataParts.length > 0) {
    lastEventData = currentDataParts.join("\n").trim();
  }

  if (!lastEventData) {
    throw new Error("SSE response did not contain usable data");
  }

  try {
    const rpc = JSON.parse(lastEventData);
    if (rpc.error) {
      throw new McpRpcError(rpc.error.code, `MCP RPC error [${rpc.error.code}]: ${rpc.error.message}`, rpc.error.data);
    }
    return rpc.result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse SSE response: ${lastEventData.slice(0, 200)}`);
    }
    throw error;
  }
}

function cleanSchemaForGemini(schema) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(cleanSchemaForGemini);
  }

  const defs = {
    ...(schema.$defs && typeof schema.$defs === "object" ? schema.$defs : {}),
    ...(schema.definitions && typeof schema.definitions === "object" ? schema.definitions : {}),
  };

  return cleanWithDefs(schema, defs, new Set());
}

function cleanWithDefs(schema, defs, refStack) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => cleanWithDefs(item, defs, refStack));
  }

  if (schema.$defs && typeof schema.$defs === "object") {
    Object.assign(defs, schema.$defs);
  }
  if (schema.definitions && typeof schema.definitions === "object") {
    Object.assign(defs, schema.definitions);
  }

  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (refStack.has(ref)) {
      return {};
    }
    const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
    if (match?.[1] && defs[match[1]]) {
      const nextStack = new Set(refStack);
      nextStack.add(ref);
      return cleanWithDefs(defs[match[1]], defs, nextStack);
    }
    return {};
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    if (GEMINI_UNSUPPORTED_KEYWORDS.has(key)) {
      continue;
    }
    if (key === "const") {
      cleaned.enum = [value];
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      cleaned[key] = Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [entryKey, cleanWithDefs(entryValue, defs, refStack)]),
      );
      continue;
    }
    if (key === "items" && value) {
      cleaned[key] = Array.isArray(value)
        ? value.map((item) => cleanWithDefs(item, defs, refStack))
        : cleanWithDefs(value, defs, refStack);
      continue;
    }
    if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      const nonNullVariants = value.filter((variant) => {
        if (!variant || typeof variant !== "object") {
          return true;
        }
        return variant.type !== "null";
      });
      if (nonNullVariants.length === 1) {
        const single = cleanWithDefs(nonNullVariants[0], defs, refStack);
        if (single && typeof single === "object" && !Array.isArray(single)) {
          Object.assign(cleaned, single);
        }
      } else {
        cleaned[key] = nonNullVariants.map((variant) => cleanWithDefs(variant, defs, refStack));
      }
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}

function parseArgs(args) {
  if (!args) {
    return {};
  }
  if (typeof args === "object") {
    return args;
  }
  try {
    return JSON.parse(args);
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : String(error);
    throw new Error(`args is not valid JSON: ${args} (${detail})`);
  }
}

const textResult = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  details: data,
});

const errorResult = (error, category) => {
  if (error && typeof error === "object" && "errcode" in error) {
    return textResult(normalizeUnsupportedBizTypePayload({
      error: error.errmsg ?? `Error code: ${error.errcode}`,
      errcode: error.errcode,
    }, error.category ?? category));
  }
  return textResult({
    error: error instanceof Error ? error.message : String(error),
  });
};

function parseMcpTextJson(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.content)) {
    return null;
  }
  const textItem = result.content.find((item) => item?.type === "text" && typeof item.text === "string");
  if (!textItem) {
    return null;
  }
  try {
    return JSON.parse(textItem.text);
  } catch {
    return null;
  }
}

function mcpContentResult(data) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(data),
    }],
  };
}

function checkBizErrorAndClearCache(ctx, result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.content)) {
    return;
  }

  for (const item of result.content) {
    if (item?.type !== "text" || !item.text) {
      continue;
    }
    try {
      const parsed = JSON.parse(item.text);
      if (typeof parsed.errcode === "number" && BIZ_CACHE_CLEAR_ERROR_CODES.has(parsed.errcode)) {
        clearCategoryCache(ctx.accountId, ctx.category);
        return;
      }
    } catch {
      // Ignore non-JSON text payloads.
    }
  }
}

async function validateSmartpageCreateFiles(pages) {
  let totalSize = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const filePath = pages[index]?.page_filepath;
    if (typeof filePath !== "string" || !filePath) {
      continue;
    }
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (stat.size > SMARTPAGE_CREATE_SINGLE_FILE_MAX_BYTES) {
      throw new Error(`smartpage_create pages[${index}] file is larger than 10MB`);
    }
    totalSize += stat.size;
    if (totalSize > SMARTPAGE_CREATE_TOTAL_FILE_MAX_BYTES) {
      throw new Error("smartpage_create page files are larger than 20MB in total");
    }
  }
}

async function resolveSmartpageCreateArgs(ctx) {
  const pages = ctx.args?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    return undefined;
  }
  if (!pages.some((page) => typeof page?.page_filepath === "string" && page.page_filepath)) {
    return undefined;
  }

  await validateSmartpageCreateFiles(pages);
  const resolvedPages = await Promise.all(
    pages.map(async (page, index) => {
      const filePath = page?.page_filepath;
      if (typeof filePath !== "string" || !filePath) {
        return page;
      }
      const pageContent = await fs.readFile(filePath, "utf8").catch((error) => {
        throw new Error(`smartpage_create pages[${index}] cannot read "${filePath}": ${error.message}`);
      });
      const { page_filepath: _pageFilepath, ...rest } = page;
      return {
        ...rest,
        page_content: pageContent,
      };
    }),
  );

  return {
    ...ctx.args,
    pages: resolvedPages,
  };
}

async function resolveBeforeCall(ctx) {
  const options = {};
  let args = ctx.args;

  if (ctx.method === "get_msg_media") {
    options.timeoutMs = MEDIA_DOWNLOAD_TIMEOUT_MS;
  }

  if (ctx.category === "doc" && ctx.method === "smartpage_create") {
    const resolvedArgs = await resolveSmartpageCreateArgs(ctx);
    if (resolvedArgs) {
      args = resolvedArgs;
    }
  }

  return { args, options };
}

function getMcpMediaRuntime() {
  const runtime = getRuntime();
  const mediaRuntime = runtime?.channel?.media ?? runtime?.media;
  if (typeof mediaRuntime?.saveMediaBuffer !== "function") {
    throw new Error("OpenClaw media runtime does not expose saveMediaBuffer");
  }
  return mediaRuntime;
}

async function saveMcpMediaBuffer(buffer, contentType, filename, maxBytes = INBOUND_MCP_MEDIA_MAX_BYTES) {
  const mediaRuntime = getMcpMediaRuntime();
  return mediaRuntime.saveMediaBuffer(buffer, contentType, "inbound", maxBytes, filename);
}

async function maybePatchSavedExtension(saved, contentType) {
  const patchExt = contentType === "audio/amr" ? ".amr" : "";
  if (!patchExt || path.extname(saved.path)) {
    return saved;
  }
  const nextPath = `${saved.path}${patchExt}`;
  try {
    await fs.rename(saved.path, nextPath);
    return { ...saved, path: nextPath };
  } catch {
    return saved;
  }
}

async function interceptMsgMediaResponse(result) {
  const bizData = parseMcpTextJson(result);
  if (bizData?.errcode !== 0 || !bizData?.media_item || typeof bizData.media_item.base64_data !== "string") {
    return result;
  }

  const mediaItem = bizData.media_item;
  const buffer = Buffer.from(mediaItem.base64_data, "base64");
  const contentType = (await detectMime({ buffer, filePath: mediaItem.name })) ?? "application/octet-stream";
  const saved = await maybePatchSavedExtension(
    await saveMcpMediaBuffer(buffer, contentType, mediaItem.name, INBOUND_MCP_MEDIA_MAX_BYTES),
    contentType,
  );

  return mcpContentResult({
    errcode: 0,
    errmsg: "ok",
    media_item: {
      media_id: mediaItem.media_id,
      name: mediaItem.name ?? path.basename(saved.path),
      type: mediaItem.type,
      local_path: saved.path,
      size: buffer.length,
      content_type: saved.contentType ?? contentType,
    },
  });
}

async function interceptSmartpageExportResponse(result) {
  const bizData = parseMcpTextJson(result);
  if (bizData?.errcode !== 0 || bizData.task_done !== true || typeof bizData.content !== "string") {
    return result;
  }

  const buffer = Buffer.from(bizData.content, "utf8");
  const saved = await saveMcpMediaBuffer(buffer, "text/markdown", "smartpage_export.md");
  return mcpContentResult({
    errcode: 0,
    errmsg: bizData.errmsg ?? "ok",
    task_done: true,
    content_path: saved.path,
  });
}

async function sendDocAuthBizMessage(ctx) {
  const wsClient = getConnectedWsClient(ctx.accountId);
  const body = {
    biz_type: DOC_AUTH_BIZ_TYPE,
  };
  if (ctx.chatId) {
    body.chat_id = ctx.chatId;
  }
  if (ctx.requesterUserId) {
    body.userid = ctx.requesterUserId;
  }
  if (ctx.chatType) {
    body.chat_type = ctx.chatType === "group" ? DOC_AUTH_CHAT_TYPE_GROUP : DOC_AUTH_CHAT_TYPE_SINGLE;
  }

  const reqId = generateReqId("biz_msg");
  await withTimeout(
    wsClient.reply({ headers: { req_id: reqId } }, body, AIBOT_SEND_BIZ_MSG_CMD),
    BIZ_MSG_SEND_TIMEOUT_MS,
    `aibot_send_biz_msg timed out after ${BIZ_MSG_SEND_TIMEOUT_MS}ms`,
  );
}

async function interceptDocAuthError(ctx, result) {
  const bizData = parseMcpTextJson(result);
  const errcode = bizData?.errcode;
  if (typeof errcode !== "number" || !DOC_AUTH_ERROR_CODES.has(errcode)) {
    return result;
  }

  let bizMessageSent = false;
  if (ctx.chatId && ctx.chatType) {
    try {
      await sendDocAuthBizMessage(ctx);
      bizMessageSent = true;
    } catch (error) {
      logger.warn(`[wecom_mcp] failed to send doc auth biz message: ${error.message}`, {
        accountId: ctx.accountId,
        chatType: ctx.chatType,
      });
    }
  } else {
    logger.warn("[wecom_mcp] doc auth error intercepted without chat context", {
      accountId: ctx.accountId,
      hasChatId: Boolean(ctx.chatId),
      hasChatType: Boolean(ctx.chatType),
    });
  }

  return mcpContentResult({
    errcode,
    errmsg: bizData.errmsg ?? "authorization error",
    _biz_msg_sent: bizMessageSent,
    _user_hint: bizMessageSent
      ? "文档授权提示卡片已直接发送给用户。请告知用户按提示授权后重试。"
      : "当前会话缺少 chatId/chatType，无法发送文档授权提示卡片。请告知用户需要授权后重试。",
  });
}

async function runAfterCall(ctx, result) {
  checkBizErrorAndClearCache(ctx, result);
  let current = await interceptDocAuthError(ctx, result);
  if (ctx.method === "get_msg_media") {
    current = await interceptMsgMediaResponse(current);
  }
  if (ctx.category === "doc" && ctx.method === "smartpage_get_export_result") {
    current = await interceptSmartpageExportResponse(current);
  }
  return current;
}

async function handleList(ctx) {
  const result = await sendJsonRpc(ctx.accountId, ctx.category, "tools/list", undefined, {
    requesterUserId: ctx.requesterUserId,
  });
  const { category } = ctx;
  const normalized = normalizeBizResult(category, result);
  if (normalized !== result) {
    return normalized;
  }
  const tools = result?.tools ?? [];
  if (tools.length === 0) {
    return {
      accountId: ctx.accountId,
      category,
      message: `No tools available under category "${category}"`,
      tools: [],
    };
  }

  return {
    accountId: ctx.accountId,
    category,
    count: tools.length,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ? cleanSchemaForGemini(tool.inputSchema) : undefined,
    })),
  };
}

async function handleCall(ctx) {
  const before = await resolveBeforeCall(ctx);
  const result = await sendJsonRpc(
    ctx.accountId,
    ctx.category,
    "tools/call",
    {
      name: ctx.method,
      arguments: before.args,
    },
    {
      ...before.options,
      requesterUserId: ctx.requesterUserId,
    },
  );
  const intercepted = await runAfterCall(ctx, result);
  return normalizeBizResult(ctx.category, intercepted);
}

export function createWeComMcpTool(options = {}) {
  const requesterUserId = normalizeOptionalString(options.requesterUserId);
  const explicitAccountId = normalizeOptionalString(options.accountId);
  const chatId = normalizeOptionalString(options.chatId);
  const chatType = options.chatType === "group" ? "group" : options.chatType === "single" ? "single" : undefined;

  return {
    name: "wecom_mcp",
    label: "WeCom MCP Tool",
    description: [
      "Calls WeCom MCP servers over Streamable HTTP.",
      "Common official categories: doc, contact, todo, meeting, schedule, msg.",
      "",
      "Category availability depends on enterprise size (WeCom official policy):",
      "  - Small teams (<=10 people): all categories (doc, contact, todo, meeting, schedule, msg)",
      "  - Enterprises (>10 people): doc only (documents & smart sheets)",
      "If a category returns errcode 846609 / 'unsupported mcp biz type', it is NOT enabled for the current bot — stop retrying immediately.",
      "",
      "Supported actions:",
      "  - list: list tools under a category",
      "  - call: call one tool under a category",
      "",
      "Examples:",
      "  wecom_mcp list contact",
      "  wecom_mcp list msg",
      "  wecom_mcp call schedule create_schedule '{\"schedule\": {...}}'",
      "  wecom_mcp call msg get_messages '{\"chat_type\": 2, \"chatid\": \"GROUP_ID\", \"begin_time\": \"2026-03-17 00:00:00\", \"end_time\": \"2026-03-20 23:59:59\"}'",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "call"],
          description: "Operation type.",
        },
        category: {
          type: "string",
          description:
            "WeCom MCP category, such as doc, contact, todo, meeting, schedule, or msg. Actual availability depends on the current bot/runtime.",
        },
        method: {
          type: "string",
          description: "Tool method name when action=call.",
        },
        args: {
          type: ["string", "object"],
          description: "Tool arguments as an object or JSON string when action=call.",
        },
      },
      required: ["action", "category"],
    },
    async execute(_toolCallId, params) {
      const accountId = explicitAccountId || resolveCurrentAccountId();
      try {
        const ctx = {
          accountId,
          requesterUserId,
          chatId,
          chatType,
          category: params.category,
          method: params.method ?? "",
          args: {},
        };
        switch (params.action) {
          case "list":
            return textResult(await handleList(ctx));
          case "call":
            if (!params.method) {
              return textResult({ error: "method is required when action=call" });
            }
            ctx.args = parseArgs(params.args);
            return textResult(await handleCall(ctx));
          default:
            return textResult({ error: `Unknown action: ${String(params.action)}` });
        }
      } catch (error) {
        return errorResult(error, params.category);
      }
    },
  };
}

export const mcpToolTesting = {
  cleanSchemaForGemini,
  parseArgs,
  OFFICIAL_WECOM_PLUGIN_VERSION,
  resetCaches() {
    mcpConfigCache.clear();
    mcpSessionCache.clear();
    statelessSessions.clear();
    inflightInitRequests.clear();
  },
};
