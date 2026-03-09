import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { upsertAgentIdOnlyEntry, seedAgentWorkspace, clearTemplateMtimeCache } from "../wecom/workspace-template.js";

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

describe("seedAgentWorkspace", () => {
  let originalStateDir;
  let stateDir;
  let templateDir;

  beforeEach(() => {
    clearTemplateMtimeCache();
    originalStateDir = process.env.OPENCLAW_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), "seed-state-"));
    templateDir = mkdtempSync(join(tmpdir(), "seed-tpl-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (originalStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalStateDir;
    }
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(templateDir, { recursive: true, force: true });
  });

  it("copies system-prompt.md and creates SOUL.md from it", () => {
    const content = "You are TestBot, a helpful assistant.";
    writeFileSync(join(templateDir, "system-prompt.md"), content);

    seedAgentWorkspace("wecom-dm-test", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-test");
    // system-prompt.md is still copied for reference
    assert.equal(existsSync(join(wsDir, "system-prompt.md")), true);
    assert.equal(readFileSync(join(wsDir, "system-prompt.md"), "utf8"), content);
    // SOUL.md is created from system-prompt.md so core can inject it
    assert.equal(existsSync(join(wsDir, "SOUL.md")), true);
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), content + "\n");
  });

  it("copies IDENTITY.md alongside system-prompt.md and creates SOUL.md", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "system prompt");
    writeFileSync(join(templateDir, "IDENTITY.md"), "identity");

    seedAgentWorkspace("wecom-dm-test2", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-test2");
    assert.equal(existsSync(join(wsDir, "system-prompt.md")), true);
    assert.equal(existsSync(join(wsDir, "IDENTITY.md")), true);
    assert.equal(existsSync(join(wsDir, "SOUL.md")), true);
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), "system prompt\n");
  });

  it("skips non-bootstrap files in template directory", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "sp");
    writeFileSync(join(templateDir, "random-notes.txt"), "notes");

    seedAgentWorkspace("wecom-dm-test3", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-test3");
    assert.equal(existsSync(join(wsDir, "system-prompt.md")), true);
    assert.equal(existsSync(join(wsDir, "random-notes.txt")), false);
  });

  it("does not fail when template has no system-prompt.md (backward compat)", () => {
    writeFileSync(join(templateDir, "IDENTITY.md"), "identity only");

    seedAgentWorkspace("wecom-dm-test4", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-test4");
    assert.equal(existsSync(join(wsDir, "IDENTITY.md")), true);
    assert.equal(existsSync(join(wsDir, "system-prompt.md")), false);
    // No SOUL.md should be created when there's no system-prompt.md
    assert.equal(existsSync(join(wsDir, "SOUL.md")), false);
  });

  it("re-seeds workspace file when template is updated", () => {
    const original = "original content";
    const updated = "updated content";
    writeFileSync(join(templateDir, "system-prompt.md"), original);

    seedAgentWorkspace("wecom-dm-reseed", {}, templateDir);
    const wsDir = join(stateDir, "workspace-wecom-dm-reseed");
    const dest = join(wsDir, "system-prompt.md");
    assert.equal(readFileSync(dest, "utf8"), original);
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), original + "\n");

    // Update template content and push mtime forward
    clearTemplateMtimeCache();
    const futureTime = Date.now() / 1000 + 10;
    writeFileSync(join(templateDir, "system-prompt.md"), updated);
    utimesSync(join(templateDir, "system-prompt.md"), futureTime, futureTime);

    seedAgentWorkspace("wecom-dm-reseed", {}, templateDir);
    assert.equal(readFileSync(dest, "utf8"), updated);
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), updated + "\n");
  });

  it("does not overwrite workspace file when template is unchanged", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "template");

    seedAgentWorkspace("wecom-dm-nochange", {}, templateDir);
    const dest = join(stateDir, "workspace-wecom-dm-nochange", "system-prompt.md");

    // Manually modify workspace file
    writeFileSync(dest, "user modified");
    // Push dest mtime forward so it's newer than template
    const futureTime = Date.now() / 1000 + 10;
    utimesSync(dest, futureTime, futureTime);

    clearTemplateMtimeCache({ agentSeedCache: false });
    seedAgentWorkspace("wecom-dm-nochange", {}, templateDir);
    assert.equal(readFileSync(dest, "utf8"), "user modified");
  });

  it("overwrites core defaults on first seed even when dest is newer", () => {
    // Simulate core writing a default IDENTITY.md with a newer mtime
    const wsDir = join(stateDir, "workspace-wecom-dm-firstseed");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "IDENTITY.md"), "core default identity");
    const futureTime = Date.now() / 1000 + 60;
    utimesSync(join(wsDir, "IDENTITY.md"), futureTime, futureTime);

    // Template has older mtime but correct content
    writeFileSync(join(templateDir, "IDENTITY.md"), "TestBot identity");

    seedAgentWorkspace("wecom-dm-firstseed", {}, templateDir);

    assert.equal(readFileSync(join(wsDir, "IDENTITY.md"), "utf8"), "TestBot identity");
  });

  it("only re-seeds the changed template file, leaves others intact", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "sp-original");
    writeFileSync(join(templateDir, "IDENTITY.md"), "id-original");

    seedAgentWorkspace("wecom-dm-partial", {}, templateDir);
    const wsDir = join(stateDir, "workspace-wecom-dm-partial");
    assert.equal(readFileSync(join(wsDir, "system-prompt.md"), "utf8"), "sp-original");
    assert.equal(readFileSync(join(wsDir, "IDENTITY.md"), "utf8"), "id-original");
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), "sp-original\n");

    // Modify workspace IDENTITY.md and push its mtime forward (simulates user edit)
    writeFileSync(join(wsDir, "IDENTITY.md"), "id-user-edit");
    const futureWs = Date.now() / 1000 + 20;
    utimesSync(join(wsDir, "IDENTITY.md"), futureWs, futureWs);

    // Update only system-prompt.md template and push its mtime forward
    clearTemplateMtimeCache({ agentSeedCache: false });
    const futureTpl = Date.now() / 1000 + 30;
    writeFileSync(join(templateDir, "system-prompt.md"), "sp-updated");
    utimesSync(join(templateDir, "system-prompt.md"), futureTpl, futureTpl);

    seedAgentWorkspace("wecom-dm-partial", {}, templateDir);

    assert.equal(readFileSync(join(wsDir, "system-prompt.md"), "utf8"), "sp-updated");
    assert.equal(readFileSync(join(wsDir, "IDENTITY.md"), "utf8"), "id-user-edit");
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), "sp-updated\n");
  });

  // --- system-prompt.md → SOUL.md injection tests ---

  it("merges system-prompt.md and SOUL.md when template has both", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "You are TestBot");
    writeFileSync(join(templateDir, "SOUL.md"), "Be professional and friendly");

    seedAgentWorkspace("wecom-dm-merge", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-merge");
    assert.equal(
      readFileSync(join(wsDir, "SOUL.md"), "utf8"),
      "You are TestBot\n\nBe professional and friendly\n",
    );
    // system-prompt.md is still copied for reference
    assert.equal(readFileSync(join(wsDir, "system-prompt.md"), "utf8"), "You are TestBot");
  });

  it("does not create SOUL.md when system-prompt.md is empty", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "   \n  ");

    seedAgentWorkspace("wecom-dm-empty-sp", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-empty-sp");
    assert.equal(existsSync(join(wsDir, "system-prompt.md")), true);
    assert.equal(existsSync(join(wsDir, "SOUL.md")), false);
  });

  it("preserves standalone SOUL.md when no system-prompt.md exists", () => {
    writeFileSync(join(templateDir, "SOUL.md"), "soul content only");

    seedAgentWorkspace("wecom-dm-soul-only", {}, templateDir);

    const wsDir = join(stateDir, "workspace-wecom-dm-soul-only");
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), "soul content only");
    assert.equal(existsSync(join(wsDir, "system-prompt.md")), false);
  });

  it("updates merged SOUL.md when system-prompt.md template changes", () => {
    writeFileSync(join(templateDir, "system-prompt.md"), "v1 prompt");
    writeFileSync(join(templateDir, "SOUL.md"), "soul part");

    seedAgentWorkspace("wecom-dm-merge-reseed", {}, templateDir);
    const wsDir = join(stateDir, "workspace-wecom-dm-merge-reseed");
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), "v1 prompt\n\nsoul part\n");

    // Update system-prompt.md
    clearTemplateMtimeCache();
    const futureTime = Date.now() / 1000 + 10;
    writeFileSync(join(templateDir, "system-prompt.md"), "v2 prompt");
    utimesSync(join(templateDir, "system-prompt.md"), futureTime, futureTime);

    seedAgentWorkspace("wecom-dm-merge-reseed", {}, templateDir);
    assert.equal(readFileSync(join(wsDir, "SOUL.md"), "utf8"), "v2 prompt\n\nsoul part\n");
  });
});
