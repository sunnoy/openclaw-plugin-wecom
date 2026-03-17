import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWecomTarget } from "../wecom/target.js";

describe("resolveWecomTarget", () => {
  it("parses explicit group targets", () => {
    assert.deepEqual(resolveWecomTarget("wecom:group:wr123"), { chatId: "wr123" });
  });

  it("parses explicit party targets", () => {
    assert.deepEqual(resolveWecomTarget("party:1"), { toParty: "1" });
  });

  it("parses explicit tag targets", () => {
    assert.deepEqual(resolveWecomTarget("tag:Ops"), { toTag: "Ops" });
  });

  it("defaults to user target", () => {
    assert.deepEqual(resolveWecomTarget("wecom:alice"), { toUser: "alice" });
  });

  it("uses heuristic chatId for wr/wc prefixes", () => {
    assert.deepEqual(resolveWecomTarget("wr_external_group"), { chatId: "wr_external_group" });
    assert.deepEqual(resolveWecomTarget("wc_internal_group"), { chatId: "wc_internal_group" });
  });

  it("parses webhook: prefix target", () => {
    assert.deepEqual(resolveWecomTarget("webhook:ops-group"), { webhook: "ops-group" });
  });

  it("parses webhook: prefix with whitespace", () => {
    assert.deepEqual(resolveWecomTarget("  webhook:dev-group  "), { webhook: "dev-group" });
  });

  it("is case-insensitive for webhook prefix", () => {
    assert.deepEqual(resolveWecomTarget("Webhook:My-Group"), { webhook: "My-Group" });
    assert.deepEqual(resolveWecomTarget("WEBHOOK:UPPER"), { webhook: "UPPER" });
  });

  it("webhook: takes priority over namespace stripping", () => {
    // "webhook:wecom:something" should NOT strip "wecom:" — it's a webhook name
    assert.deepEqual(resolveWecomTarget("webhook:wecom:something"), { webhook: "wecom:something" });
  });

  it("treats short digit strings as department (party) IDs", () => {
    assert.deepEqual(resolveWecomTarget("2"), { toParty: "2" });
    assert.deepEqual(resolveWecomTarget("999"), { toParty: "999" });
    assert.deepEqual(resolveWecomTarget("wecom:42"), { toParty: "42" });
    assert.deepEqual(resolveWecomTarget("123456"), { toParty: "123456" });
  });

  it("treats long digit strings (phone numbers) as user IDs", () => {
    assert.deepEqual(resolveWecomTarget("wecom:13800001111"), { toUser: "13800001111" });
    assert.deepEqual(resolveWecomTarget("1380000111"), { toUser: "1380000111" });
  });

  it("explicit party: prefix still works for long digit strings", () => {
    assert.deepEqual(resolveWecomTarget("party:13800001111"), { toParty: "13800001111" });
  });
});
