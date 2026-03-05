import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveWorkspaceHostPathSafe } from "../wecom/outbound-delivery.js";

describe("resolveWorkspaceHostPathSafe", () => {
  const workspaceDir = "/tmp/openclaw-workspace-agent";

  it("resolves normal /workspace paths inside workspace", () => {
    const hostPath = resolveWorkspaceHostPathSafe({
      workspaceDir,
      workspacePath: "/workspace/reports/result.txt",
    });
    assert.equal(hostPath, resolve(workspaceDir, "reports/result.txt"));
  });

  it("rejects traversal paths that escape workspace", () => {
    const hostPath = resolveWorkspaceHostPathSafe({
      workspaceDir,
      workspacePath: "/workspace/../../etc/passwd",
    });
    assert.equal(hostPath, null);
  });

  it("rejects /workspace root-only path", () => {
    const hostPath = resolveWorkspaceHostPathSafe({
      workspaceDir,
      workspacePath: "/workspace/",
    });
    assert.equal(hostPath, null);
  });
});
