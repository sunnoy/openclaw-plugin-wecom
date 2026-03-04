import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { upsertAgentIdOnlyEntry } from "../wecom/workspace-template.js";

describe("upsertAgentIdOnlyEntry", () => {
  it("adds heartbeat config when creating a dynamic agent entry", () => {
    const cfg = { agents: { list: [{ id: "main" }] } };
    const changed = upsertAgentIdOnlyEntry(cfg, "wecom-dm-lirui");

    assert.equal(changed, true);
    assert.deepEqual(cfg.agents.list, [
      { id: "main" },
      { id: "wecom-dm-lirui", heartbeat: {} },
    ]);
  });

  it("creates agents.list with main and new dynamic agent heartbeat config", () => {
    const cfg = {};
    const changed = upsertAgentIdOnlyEntry(cfg, "wecom-dm-lirui");

    assert.equal(changed, true);
    assert.deepEqual(cfg.agents.list, [
      { id: "main" },
      { id: "wecom-dm-lirui", heartbeat: {} },
    ]);
  });

  it("does not overwrite existing entries", () => {
    const cfg = {
      agents: {
        list: [{ id: "main" }, { id: "wecom-dm-lirui", heartbeat: { every: "5m" } }],
      },
    };
    const changed = upsertAgentIdOnlyEntry(cfg, "wecom-dm-lirui");

    assert.equal(changed, false);
    assert.deepEqual(cfg.agents.list, [
      { id: "main" },
      { id: "wecom-dm-lirui", heartbeat: { every: "5m" } },
    ]);
  });
});
