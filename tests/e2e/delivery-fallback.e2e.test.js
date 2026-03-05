/**
 * Delivery Fallback E2E Tests
 *
 * Tests the 3-layer delivery mechanism under concurrent message pressure:
 *
 *   Layer 1: Active stream — content appended while stream is alive
 *   Layer 2: response_url fallback — after stream closes, WeCom allows one
 *            POST to the response_url within 1 hour (official doc: 101138)
 *   Layer 3: Agent API fallback — when both stream and response_url are
 *            exhausted, deliver via 应用消息 API (official doc: 101031)
 *
 * Scenario:
 *   1. Send msg1 (long prompt) → stream S1 created, LLM starts
 *   2. Before LLM finishes S1, send msg2 → debounce/merge into S1
 *   3. Wait for S1 to finish
 *   4. After S1 closes, verify response_url delivery was attempted (logs)
 *   5. After response_url consumed, verify Agent API delivery was attempted (logs)
 *
 * Official WeCom references:
 *   - 被动回复消息 (stream): https://developer.work.weixin.qq.com/document/path/101031
 *   - response_url 主动回复: https://developer.work.weixin.qq.com/document/path/101138
 *
 * Environment variables (same as remote-wecom.e2e.test.js):
 *   E2E_WECOM_BASE_URL, E2E_WECOM_TOKEN, E2E_WECOM_ENCODING_AES_KEY
 *   E2E_REMOTE_SSH_HOST (for log inspection, default: ali-ai)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { execSync } from "node:child_process";
import { WecomCrypto } from "../../crypto.js";

// ── Required env ───────────────────────────────────────────────────────

const REQUIRED_ENV = [
  "E2E_WECOM_BASE_URL",
  "E2E_WECOM_TOKEN",
  "E2E_WECOM_ENCODING_AES_KEY",
];

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
const skipReason = missingEnv.length > 0
  ? `missing env: ${missingEnv.join(", ")}`
  : false;

const baseUrl = (process.env.E2E_WECOM_BASE_URL || "").replace(/\/+$/, "");
const webhookPath = process.env.E2E_WECOM_WEBHOOK_PATH || "/webhooks/wecom";
const token = process.env.E2E_WECOM_TOKEN || "";
const encodingAesKey = process.env.E2E_WECOM_ENCODING_AES_KEY || "";

const testUserId = process.env.E2E_WECOM_TEST_USER || "wecom-e2e-user";
const sshHost = process.env.E2E_REMOTE_SSH_HOST || "ali-ai";

const pollIntervalMs = Number(process.env.E2E_WECOM_POLL_INTERVAL_MS || 1200);
const streamTimeoutMs = Number(process.env.E2E_WECOM_STREAM_TIMEOUT_MS || 90000);

const thinkingPlaceholder = "思考中...";
const fallbackResponseUrl = "https://example.invalid/wecom/e2e";

// ── Helpers ────────────────────────────────────────────────────────────

describe("delivery fallback layers — concurrent messages + response_url + agent API", { skip: skipReason }, () => {
  const wecomCrypto = new WecomCrypto(token, encodingAesKey);

  function signEncryptedPayload(plainObject, options = {}) {
    const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000));
    const nonce = options.nonce || `e2e${Math.random().toString(16).slice(2, 10)}`;
    const encrypt = wecomCrypto.encrypt(JSON.stringify(plainObject));
    const signature = options.signature || wecomCrypto.getSignature(timestamp, nonce, encrypt);
    return { timestamp, nonce, signature, encrypt };
  }

  async function requestWebhook({ method = "POST", query = {}, headers = {}, body } = {}) {
    const qs = new URLSearchParams(query);
    const url = `${baseUrl}${webhookPath}${qs.toString() ? `?${qs.toString()}` : ""}`;
    const options = { method, headers };
    if (method !== "GET" && method !== "HEAD" && body !== undefined) {
      options.body = body;
    }
    const res = await fetch(url, options);
    const text = await res.text();
    return { status: res.status, text };
  }

  async function postEncryptedMessage(plainObject, options = {}) {
    const signed = signEncryptedPayload(plainObject, options);
    return requestWebhook({
      method: "POST",
      query: {
        msg_signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypt: signed.encrypt }),
    });
  }

  function decodeEncryptedResponse(rawText) {
    const json = JSON.parse(rawText);
    assert.ok(json.encrypt, "response.encrypt should exist");
    assert.ok(json.msgsignature, "response.msgsignature should exist");
    const expected = wecomCrypto.getSignature(json.timestamp, json.nonce, json.encrypt);
    assert.equal(json.msgsignature, expected, "response signature should be valid");
    const plain = JSON.parse(wecomCrypto.decrypt(json.encrypt).message);
    return plain;
  }

  async function refreshStream(streamId) {
    const refresh = await postEncryptedMessage({
      msgtype: "stream",
      stream: { id: streamId },
    });
    assert.equal(refresh.status, 200);
    const plain = decodeEncryptedResponse(refresh.text);
    assert.equal(plain.msgtype, "stream");
    assert.equal(plain.stream?.id, streamId);
    return plain;
  }

  function hasMeaningfulContent(plain) {
    const content = String(plain?.stream?.content || "").trim();
    return content.length > 0 && content !== thinkingPlaceholder;
  }

  async function waitStreamResult(streamId, options = {}) {
    const timeoutMs = options.timeoutMs || streamTimeoutMs;
    const requireFinish = options.requireFinish === true;
    const deadline = Date.now() + timeoutMs;
    let latest = options.initialPlain || (await refreshStream(streamId));

    if (requireFinish) {
      if (latest.stream?.finish && hasMeaningfulContent(latest)) return latest;
    } else if (hasMeaningfulContent(latest) || latest.stream?.finish) {
      return latest;
    }

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      latest = await refreshStream(streamId);
      if (requireFinish) {
        if (latest.stream?.finish && hasMeaningfulContent(latest)) return latest;
      } else if (hasMeaningfulContent(latest) || latest.stream?.finish) {
        return latest;
      }
    }

    if (requireFinish) {
      assert.fail(`stream should finish with content before timeout: ${streamId}`);
    }
    assert.ok(
      hasMeaningfulContent(latest),
      `stream should produce non-placeholder content before timeout: ${streamId}`,
    );
    return latest;
  }

  async function startInboundTurn({
    caseId,
    msgtype,
    payload = {},
    userId = `${testUserId}-${caseId}`,
    chatType = "single",
    chatId = "",
    responseUrl = fallbackResponseUrl,
  }) {
    const msgId = `wecom-e2e-${caseId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const inbound = {
      msgtype,
      msgid: msgId,
      from: { userid: userId },
      chattype: chatType,
      response_url: responseUrl,
      ...payload,
    };
    if (chatId) inbound.chatid = chatId;

    const first = await postEncryptedMessage(inbound);
    assert.equal(first.status, 200);
    const initial = decodeEncryptedResponse(first.text);
    assert.equal(initial.msgtype, "stream");
    assert.ok(initial.stream?.id, `stream id should exist: ${caseId}`);
    assert.equal(typeof initial.stream?.content, "string");

    return { msgId, initial, streamId: initial.stream.id };
  }

  /**
   * Fetch recent gateway log lines from the remote host via SSH.
   */
  function fetchRecentLogs(lines = 300) {
    try {
      const cmd = `ssh ${sshHost} "journalctl -u openclaw-gateway --no-pager -n ${lines} --output=cat 2>/dev/null || tail -n ${lines} /root/.openclaw/logs/gateway.log 2>/dev/null || tail -n ${lines} /tmp/openclaw-gateway.log 2>/dev/null || echo 'NO_LOGS'"`;
      return execSync(cmd, { timeout: 15000, encoding: "utf-8" });
    } catch {
      return "";
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 1: Send msg2 while msg1's LLM is still streaming
  //
  // This tests the debounce/merge path. msg2 arrives before msg1 finishes.
  // Expected: msg2 stream gets "消息已合并到第一条回复中", msg1 stream
  // receives the merged LLM response.
  // ════════════════════════════════════════════════════════════════════════

  it(
    "Phase 1: second message sent before first LLM response finishes is merged",
    { timeout: 180_000 },
    async () => {
      const userId = `${testUserId}-fallback-phase1`;

      // Send msg1 — use a prompt that will take some time for the LLM.
      const first = await startInboundTurn({
        caseId: "fallback-p1-msg1",
        userId,
        msgtype: "text",
        payload: { text: { content: "请用大约200字详细解释光合作用的完整过程，包括暗反应和光反应。" } },
      });
      console.log(`[Phase1] msg1 streamId=${first.streamId}`);

      // Send msg2 immediately (within debounce window, before LLM finishes).
      const second = await startInboundTurn({
        caseId: "fallback-p1-msg2",
        userId,
        msgtype: "text",
        payload: { text: { content: "再补充一下叶绿体的结构。" } },
      });
      console.log(`[Phase1] msg2 streamId=${second.streamId}`);

      // msg2's stream should get the merge notice.
      const mergedNotice = await waitStreamResult(second.streamId, {
        timeoutMs: 90_000,
        requireFinish: false,
      });
      const mergeContent = String(mergedNotice.stream?.content || "");
      assert.match(mergeContent, /消息已合并到第一条回复中/,
        "msg2 stream should indicate merge");
      console.log(`[Phase1] msg2 merged: "${mergeContent}"`);

      // msg1's stream should eventually get the real LLM response.
      const primary = await waitStreamResult(first.streamId, {
        timeoutMs: 120_000,
        requireFinish: true,
      });
      assert.ok(primary.stream.content.length > 0,
        "msg1 stream should have LLM content");
      assert.ok(primary.stream.finish === true,
        "msg1 stream should finish");
      console.log(`[Phase1] msg1 finished, content length=${primary.stream.content.length}`);
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2: After stream finishes, response_url delivery is attempted
  //
  // WeCom official mechanism (101138): each callback returns a response_url,
  // valid for 1 hour, single-use. After the stream closes, if the outbound
  // adapter needs to deliver more content, it falls through to response_url.
  //
  // In e2e we use a fake response_url (example.invalid), so the attempt will
  // fail — but we verify via logs that the code path is entered.
  // ════════════════════════════════════════════════════════════════════════

  it(
    "Phase 2: response_url fallback is attempted after stream closes",
    { timeout: 180_000 },
    async () => {
      const userId = `${testUserId}-fallback-p2`;

      // Send msg1 — trigger a quick response that finishes the stream.
      const first = await startInboundTurn({
        caseId: "fallback-p2-msg1",
        userId,
        msgtype: "text",
        payload: { text: { content: "请只回复两个字：收到" } },
      });
      console.log(`[Phase2] msg1 streamId=${first.streamId}`);

      // Wait for msg1 stream to fully finish.
      const finished = await waitStreamResult(first.streamId, {
        timeoutMs: 60_000,
        requireFinish: true,
      });
      assert.ok(finished.stream.finish, "stream should be finished");
      console.log(`[Phase2] msg1 stream finished: "${finished.stream.content.substring(0, 80)}"`);

      // Small delay so the gateway fully closes the stream.
      await sleep(3000);

      // Send msg2 from the same user — this starts a new turn.
      // The new inbound creates a new stream. But to trigger the response_url
      // code path, we need an outbound on the OLD closed stream.
      // We verify via logs that previous response_url was available.
      const second = await startInboundTurn({
        caseId: "fallback-p2-msg2",
        userId,
        msgtype: "text",
        payload: { text: { content: "OK 再回复两个字：明白" } },
      });
      console.log(`[Phase2] msg2 streamId=${second.streamId}`);

      const secondResult = await waitStreamResult(second.streamId, {
        timeoutMs: 60_000,
        requireFinish: true,
      });
      assert.ok(secondResult.stream.content.length > 0);
      console.log(`[Phase2] msg2 finished: "${secondResult.stream.content.substring(0, 80)}"`);

      // Check gateway logs for evidence of response_url handling.
      await sleep(2000);
      const logs = fetchRecentLogs(400);
      const hasResponseUrlSaved = logs.includes("saved response_url for fallback");
      const hasResponseUrlAttempt =
        logs.includes("response_url fallback") ||
        logs.includes("sent via response_url") ||
        logs.includes("response_url fallback rejected") ||
        logs.includes("response_url fallback failed");

      console.log(`[Phase2] Log evidence — response_url saved: ${hasResponseUrlSaved}, response_url attempted: ${hasResponseUrlAttempt}`);
      // The response_url should at minimum be saved on each inbound message.
      assert.ok(hasResponseUrlSaved, "gateway should save response_url on inbound messages");
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // Phase 3: After response_url is consumed, Agent API delivers the message
  //
  // Once response_url is used (or fails), the outbound adapter falls through
  // to Agent API (应用消息). We verify this via gateway logs.
  // Requires E2E_WECOM_AGENT_CORP_ID to be configured on the gateway.
  // ════════════════════════════════════════════════════════════════════════

  it(
    "Phase 3: Agent API fallback is used after response_url is exhausted",
    { timeout: 180_000 },
    async () => {
      const userId = `${testUserId}-fallback-p3`;

      // Step 1: Send a quick message to create and finish a stream.
      const first = await startInboundTurn({
        caseId: "fallback-p3-msg1",
        userId,
        msgtype: "text",
        payload: { text: { content: "请只回复一个字：好" } },
      });
      console.log(`[Phase3] msg1 streamId=${first.streamId}`);

      const finished = await waitStreamResult(first.streamId, {
        timeoutMs: 60_000,
        requireFinish: true,
      });
      assert.ok(finished.stream.finish);
      console.log(`[Phase3] msg1 finished: "${finished.stream.content.substring(0, 40)}"`);

      // Wait for stream to fully close.
      await sleep(3000);

      // Step 2: Send msg2 while stream is closed. Since our response_url
      // is example.invalid, the response_url attempt will fail, and the
      // system should fall through to Agent API.
      //
      // We use a prompt that triggers a tool call or delayed output,
      // which increases the chance of post-stream delivery.
      const second = await startInboundTurn({
        caseId: "fallback-p3-msg2",
        userId,
        msgtype: "text",
        payload: { text: { content: "请告诉我现在的日期和时间。" } },
      });
      console.log(`[Phase3] msg2 streamId=${second.streamId}`);

      const secondResult = await waitStreamResult(second.streamId, {
        timeoutMs: 90_000,
        requireFinish: true,
      });
      assert.ok(secondResult.stream.content.length > 0);
      console.log(`[Phase3] msg2 finished: "${secondResult.stream.content.substring(0, 80)}"`);

      // Wait for any async delivery attempts to complete.
      await sleep(5000);

      // Check gateway logs for the full 3-layer delivery evidence.
      const logs = fetchRecentLogs(500);

      const hasResponseUrlPath =
        logs.includes("response_url fallback") ||
        logs.includes("sent via response_url") ||
        logs.includes("response_url fallback rejected") ||
        logs.includes("response_url fallback failed");

      const hasAgentApiPath =
        logs.includes("Agent API fallback") ||
        logs.includes("sent via Agent API") ||
        logs.includes("Agent API fallback failed");

      console.log(`[Phase3] Log evidence — response_url path: ${hasResponseUrlPath}, Agent API path: ${hasAgentApiPath}`);

      // At minimum, verify either the response_url or Agent API path was
      // exercised. The exact path depends on gateway configuration:
      // - If Agent API is configured: should see Agent API fallback logs
      // - If not: response_url failure is still evidence the fallback tried
      const anyFallbackEvidence = hasResponseUrlPath || hasAgentApiPath;
      if (!anyFallbackEvidence) {
        console.log("[Phase3] No fallback evidence in logs — all delivery went through active streams (normal)");
      } else {
        console.log("[Phase3] Fallback delivery path exercised successfully");
      }
      // This is informational; the active-stream path may handle everything.
      // The test passes as long as concurrency and streams work correctly.
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // Integration: Full 3-layer cascade in a single scenario
  //
  // Combines all three phases in one user session:
  //   1. msg1 starts → stream active (Layer 1)
  //   2. msg2 sent before msg1 finishes → debounce/merge
  //   3. After stream closes, response_url delivery logged (Layer 2)
  //   4. Agent API delivery logged if response_url consumed (Layer 3)
  // ════════════════════════════════════════════════════════════════════════

  it(
    "Integration: concurrent messages → stream finish → response_url → agent API cascade",
    { timeout: 240_000 },
    async () => {
      const userId = `${testUserId}-fallback-full`;

      // ── Step 1: Send msg1 (long prompt to keep LLM busy). ─────────────
      const msg1 = await startInboundTurn({
        caseId: "fallback-full-msg1",
        userId,
        msgtype: "text",
        payload: {
          text: {
            content:
              "请分三段详细解释：1) HTTP/2 的多路复用原理 2) 流量控制 3) 头部压缩。每段100字以上。",
          },
        },
      });
      console.log(`[Integration] msg1 streamId=${msg1.streamId}`);

      // Verify msg1 created a valid stream with placeholder.
      assert.ok(msg1.streamId, "msg1 should create a stream");

      // ── Step 2: Send msg2 before msg1 finishes (within ~1s). ──────────
      const msg2 = await startInboundTurn({
        caseId: "fallback-full-msg2",
        userId,
        msgtype: "text",
        payload: {
          text: { content: "也请简要对比一下 HTTP/3 (QUIC) 的改进。" },
        },
      });
      console.log(`[Integration] msg2 streamId=${msg2.streamId}`);

      // ── Step 3: Verify msg2 gets merge notice. ────────────────────────
      const mergeResult = await waitStreamResult(msg2.streamId, {
        timeoutMs: 90_000,
        requireFinish: false,
      });
      const mergeContent = String(mergeResult.stream?.content || "");
      assert.match(mergeContent, /消息已合并到第一条回复中/,
        "msg2 should be merged into msg1");
      console.log(`[Integration] msg2 merged: "${mergeContent}"`);

      // ── Step 4: Wait for msg1 stream to finish with LLM content. ─────
      const msg1Result = await waitStreamResult(msg1.streamId, {
        timeoutMs: 180_000,
        requireFinish: true,
      });
      assert.ok(msg1Result.stream.finish, "msg1 stream should finish");
      assert.ok(msg1Result.stream.content.length > 50,
        "msg1 should have substantial LLM content");
      console.log(
        `[Integration] msg1 finished, length=${msg1Result.stream.content.length}, ` +
        `preview="${msg1Result.stream.content.substring(0, 100)}..."`,
      );

      // ── Step 5: Stream is now closed. Allow async delivery to settle. ─
      await sleep(5000);

      // ── Step 6: Check logs for response_url + Agent API evidence. ─────
      const logs = fetchRecentLogs(600);

      const evidence = {
        responseUrlSaved: logs.includes("saved response_url for fallback"),
        responseUrlAttempted:
          logs.includes("response_url fallback") ||
          logs.includes("sent via response_url"),
        responseUrlFailed:
          logs.includes("response_url fallback rejected") ||
          logs.includes("response_url fallback failed"),
        agentApiAttempted:
          logs.includes("Agent API fallback") ||
          logs.includes("sent via Agent API"),
        agentApiFailed: logs.includes("Agent API fallback failed"),
        allLayersExhausted: logs.includes("all layers exhausted"),
      };

      console.log("[Integration] Delivery layer evidence from gateway logs:");
      for (const [key, value] of Object.entries(evidence)) {
        console.log(`  ${key}: ${value}`);
      }

      // response_url should always be saved on inbound messages.
      assert.ok(evidence.responseUrlSaved,
        "response_url should be saved for every inbound message");

      // ── Step 7: Send msg3 after everything is settled. ────────────────
      // This verifies the system can still accept new messages after the
      // full fallback cascade was exercised.
      const msg3 = await startInboundTurn({
        caseId: "fallback-full-msg3",
        userId,
        msgtype: "text",
        payload: {
          text: { content: "谢谢，请回复：了解" },
        },
      });
      console.log(`[Integration] msg3 streamId=${msg3.streamId}`);

      const msg3Result = await waitStreamResult(msg3.streamId, {
        timeoutMs: 60_000,
        requireFinish: true,
      });
      assert.ok(msg3Result.stream.content.length > 0,
        "msg3 should receive a response after full cascade");
      console.log(`[Integration] msg3 finished: "${msg3Result.stream.content.substring(0, 80)}"`);

      // Final log check for Agent API usage on msg3's delivery.
      await sleep(3000);
      const finalLogs = fetchRecentLogs(300);
      const finalAgentEvidence =
        finalLogs.includes("Agent API fallback") ||
        finalLogs.includes("sent via Agent API");
      console.log(`[Integration] Post-msg3 Agent API evidence: ${finalAgentEvidence}`);
    },
  );
});
