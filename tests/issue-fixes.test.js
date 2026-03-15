/**
 * Unit tests for issue fixes: #78, #84, #85.
 *
 * - #78: configSchema additionalProperties should be true (multi-account)
 * - #84: splitTextByByteLimit — Agent API long text chunking
 * - #85: Explicit bindings should prevent dynamic agent override
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { splitTextByByteLimit } from "../utils.js";
import { wecomChannelPlugin } from "../wecom/channel-plugin.js";
import { setOpenclawConfig } from "../wecom/state.js";
import plugin from "../index.js";

// ═══════════════════════════════════════════════════════════════════════
// #78: configSchema additionalProperties — multi-account support
// ═══════════════════════════════════════════════════════════════════════

describe("configSchema (issue #78 + upstream alignment)", () => {
  it("plugin-level configSchema has safeParse method (emptyPluginConfigSchema format)", () => {
    assert.equal(typeof plugin.configSchema.safeParse, "function");
  });

  it("plugin-level configSchema.safeParse accepts empty object", () => {
    const result = plugin.configSchema.safeParse({});
    assert.equal(result.success, true);
  });

  it("plugin-level configSchema.safeParse accepts undefined", () => {
    const result = plugin.configSchema.safeParse(undefined);
    assert.equal(result.success, true);
  });

  it("plugin-level configSchema.safeParse rejects non-object", () => {
    assert.equal(plugin.configSchema.safeParse("string").success, false);
    assert.equal(plugin.configSchema.safeParse(42).success, false);
    assert.equal(plugin.configSchema.safeParse([]).success, false);
  });

  it("channel-level configSchema allows additional properties for multi-account keys", () => {
    const schema = wecomChannelPlugin.configSchema.schema;
    assert.equal(
      schema.additionalProperties,
      true,
      "channel configSchema.schema.additionalProperties should be true to allow arbitrary account ID keys",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Upstream alignment: deliveryMode
// ═══════════════════════════════════════════════════════════════════════

describe("outbound deliveryMode (upstream alignment)", () => {
  afterEach(() => {
    setOpenclawConfig(null);
  });

  it("defaults to 'gateway' when no config override", () => {
    assert.equal(wecomChannelPlugin.outbound.deliveryMode, "gateway");
  });

  it("respects config override to 'direct'", () => {
    setOpenclawConfig({ channels: { wecom: { deliveryMode: "direct" } } });
    assert.equal(wecomChannelPlugin.outbound.deliveryMode, "direct");
  });

  it("ignores invalid deliveryMode values", () => {
    setOpenclawConfig({ channels: { wecom: { deliveryMode: "invalid" } } });
    assert.equal(wecomChannelPlugin.outbound.deliveryMode, "gateway");
  });
});

describe("messaging.normalizeTarget", () => {
  it("treats prefixed and unprefixed DM targets as the same WeCom user", () => {
    assert.equal(wecomChannelPlugin.messaging.normalizeTarget("lirui"), "user:lirui");
    assert.equal(wecomChannelPlugin.messaging.normalizeTarget("wecom:lirui"), "user:lirui");
    assert.equal(wecomChannelPlugin.messaging.normalizeTarget("wework:lirui"), "user:lirui");
  });

  it("canonicalizes explicit chat and group targets", () => {
    assert.equal(wecomChannelPlugin.messaging.normalizeTarget("group:wr123"), "chat:wr123");
    assert.equal(wecomChannelPlugin.messaging.normalizeTarget("chat:wr123"), "chat:wr123");
    assert.equal(wecomChannelPlugin.messaging.normalizeTarget("wecom:group:wr123"), "chat:wr123");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #84: splitTextByByteLimit — text chunking for Agent API (2048 byte limit)
// ═══════════════════════════════════════════════════════════════════════

describe("splitTextByByteLimit (issue #84)", () => {
  it("returns single chunk for short text", () => {
    const chunks = splitTextByByteLimit("hello world");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "hello world");
  });

  it("returns single chunk for empty string", () => {
    const chunks = splitTextByByteLimit("");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "");
  });

  it("returns single chunk for text exactly at limit", () => {
    const text = "a".repeat(2000);
    const chunks = splitTextByByteLimit(text, 2000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], text);
  });

  it("splits long ASCII text into multiple chunks", () => {
    const text = "abcdefghij".repeat(50); // 500 bytes
    const chunks = splitTextByByteLimit(text, 100);
    assert.ok(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);
    const rejoined = chunks.join("");
    assert.equal(rejoined, text, "Rejoined chunks should equal original text");
    for (const chunk of chunks) {
      assert.ok(
        Buffer.byteLength(chunk, "utf8") <= 100,
        `Chunk exceeds byte limit: ${Buffer.byteLength(chunk, "utf8")}`,
      );
    }
  });

  it("splits long Chinese text respecting UTF-8 multi-byte boundaries", () => {
    // Each Chinese character = 3 bytes in UTF-8
    const text = "你好世界测试".repeat(100); // 600 chars = 1800 bytes
    const chunks = splitTextByByteLimit(text, 200);
    assert.ok(chunks.length > 1);
    const rejoined = chunks.join("");
    assert.equal(rejoined, text);
    for (const chunk of chunks) {
      assert.ok(
        Buffer.byteLength(chunk, "utf8") <= 200,
        `Chunk exceeds byte limit: ${Buffer.byteLength(chunk, "utf8")}`,
      );
    }
  });

  it("prefers splitting at newline boundaries", () => {
    const line = "a".repeat(80);
    // 3 lines of 80 chars = 240 bytes, limit = 200
    const text = `${line}\n${line}\n${line}`;
    const chunks = splitTextByByteLimit(text, 200);
    assert.ok(chunks.length >= 2);
    // First chunk should end at a newline boundary
    assert.ok(
      chunks[0].endsWith("\n") || chunks[0] === line,
      "First chunk should split at newline boundary",
    );
  });

  it("handles text with no newlines gracefully", () => {
    const text = "x".repeat(500);
    const chunks = splitTextByByteLimit(text, 100);
    assert.ok(chunks.length === 5);
    for (const chunk of chunks) {
      assert.equal(chunk.length, 100);
    }
  });

  it("handles mixed ASCII and CJK content", () => {
    // Mix of 1-byte ASCII and 3-byte Chinese characters
    const text = "Hello你好World世界Test测试".repeat(50);
    const chunks = splitTextByByteLimit(text, 100);
    assert.ok(chunks.length > 1);
    const rejoined = chunks.join("");
    assert.equal(rejoined, text);
    for (const chunk of chunks) {
      assert.ok(Buffer.byteLength(chunk, "utf8") <= 100);
    }
  });

  it("uses default limit of 2000 bytes", () => {
    const text = "a".repeat(4000);
    const chunks = splitTextByByteLimit(text);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, 2000);
    assert.equal(chunks[1].length, 2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// #85: Explicit bindings prevent dynamic agent override
// ═══════════════════════════════════════════════════════════════════════

describe("bindings detection logic (issue #85)", () => {
  function hasExplicitBinding(config, accountId) {
    return (
      Array.isArray(config?.bindings) &&
      config.bindings.some(
        (b) => b.match?.channel === "wecom" && b.match?.accountId === accountId,
      )
    );
  }

  it("returns false when no bindings configured", () => {
    assert.equal(hasExplicitBinding({}, "amy"), false);
    assert.equal(hasExplicitBinding({ bindings: [] }, "amy"), false);
    assert.equal(hasExplicitBinding(null, "amy"), false);
    assert.equal(hasExplicitBinding(undefined, "amy"), false);
  });

  it("returns false when bindings exist but none match channel+accountId", () => {
    const config = {
      bindings: [
        { agentId: "bot1", match: { channel: "slack", accountId: "main" } },
        { agentId: "bot2", match: { channel: "wecom", accountId: "other" } },
      ],
    };
    assert.equal(hasExplicitBinding(config, "amy"), false);
  });

  it("returns true when binding matches channel and accountId", () => {
    const config = {
      bindings: [
        {
          agentId: "amy",
          match: { channel: "wecom", accountId: "amy" },
        },
      ],
    };
    assert.equal(hasExplicitBinding(config, "amy"), true);
  });

  it("returns true for matching binding among multiple entries", () => {
    const config = {
      bindings: [
        { agentId: "bot1", match: { channel: "slack", accountId: "main" } },
        { agentId: "sara", match: { channel: "wecom", accountId: "sara" } },
        { agentId: "amy", match: { channel: "wecom", accountId: "amy" } },
      ],
    };
    assert.equal(hasExplicitBinding(config, "amy"), true);
    assert.equal(hasExplicitBinding(config, "sara"), true);
    assert.equal(hasExplicitBinding(config, "other"), false);
  });

  it("returns false when binding has channel but no accountId", () => {
    const config = {
      bindings: [{ agentId: "bot", match: { channel: "wecom" } }],
    };
    assert.equal(hasExplicitBinding(config, "amy"), false);
  });

  it("returns false when bindings is not an array", () => {
    assert.equal(hasExplicitBinding({ bindings: "invalid" }, "amy"), false);
    assert.equal(hasExplicitBinding({ bindings: {} }, "amy"), false);
  });
});
