import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { THINKING_MESSAGE } from "../wecom/constants.js";
import { wsMonitorTesting } from "../wecom/ws-monitor.js";

const { buildWsStreamContent, resolveWsKeepaliveContent } = wsMonitorTesting;

describe("ws keepalive content", () => {
  it("prefers the current non-empty stream content", () => {
    const content = resolveWsKeepaliveContent({
      reasoningText: "先分析问题",
      visibleText: "",
      lastStreamText: THINKING_MESSAGE,
    });

    assert.equal(content, buildWsStreamContent({
      reasoningText: "先分析问题",
      visibleText: "",
      finish: false,
    }));
  });

  it("falls back to the last non-empty stream payload when no new text exists", () => {
    const content = resolveWsKeepaliveContent({
      reasoningText: "",
      visibleText: "",
      lastStreamText: "<think>先分析问题",
    });

    assert.equal(content, "<think>先分析问题");
  });

  it("falls back to the thinking placeholder before the model emits any token", () => {
    const content = resolveWsKeepaliveContent({
      reasoningText: "",
      visibleText: "",
      lastStreamText: "",
    });

    assert.equal(content, THINKING_MESSAGE);
  });
});
