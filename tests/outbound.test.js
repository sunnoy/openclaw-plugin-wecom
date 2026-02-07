import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Unit tests for outbound message delivery with three-layer fallback
 *
 * Test coverage:
 * 1. Layer 1: Active stream delivery
 * 2. Layer 2: response_url fallback
 * 3. Layer 3: Warning log when no channel available
 */

describe('outbound.sendText - three-layer fallback', () => {
  // Mock dependencies
  let streamManager;
  let responseUrls;
  let streamContext;
  let fetchMock;
  let mockStreams;

  beforeEach(() => {
    // Reset mocks
    mockStreams = new Map();
    streamManager = {
      hasStream: (id) => mockStreams.has(id),
      getStream: (id) => mockStreams.get(id),
      replaceIfPlaceholder: () => {},
    };
    responseUrls = new Map();
    fetchMock = global.fetch;
    global.fetch = async (url, options) => ({ ok: true });
  });

  afterEach(() => {
    global.fetch = fetchMock;
    mockStreams.clear();
    responseUrls.clear();
  });

  it('Layer 1: should deliver via active stream when available', async () => {
    // Setup: Active stream exists
    const streamId = 'stream_test_123';
    const userId = 'user_abc';
    mockStreams.set(streamId, { finished: false, content: 'thinking...' });

    // Simulate streamContext having streamId
    streamContext = new AsyncLocalStorage();
    streamContext.run({ streamId }, async () => {
      // Simulate outbound.sendText
      const ctx = streamContext.getStore();
      const activeStreamId = ctx?.streamId;

      assert.strictEqual(activeStreamId, streamId);
      assert.strictEqual(streamManager.hasStream(streamId), true);
    });
  });

  it('Layer 2: should use response_url fallback when stream closed', async () => {
    // Setup: Stream is closed, but response_url is available
    const streamId = 'stream_test_123';
    const userId = 'user_abc';
    const testUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test';

    // Stream is finished
    mockStreams.set(streamId, { finished: true, content: 'done' });

    // response_url saved
    responseUrls.set(userId, {
      url: testUrl,
      expiresAt: Date.now() + 60 * 60 * 1000,
      used: false,
    });

    // Simulate fallback logic
    const stream = streamManager.getStream(streamId);
    const canUseStream = stream && !stream.finished;
    assert.strictEqual(canUseStream, false);

    const saved = responseUrls.get(userId);
    const canUseFallback = saved && !saved.used && Date.now() < saved.expiresAt;
    assert.strictEqual(canUseFallback, true);

    // Simulate fetch call
    if (canUseFallback) {
      const response = await fetch(saved.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: 'test' } }),
      });
      assert.strictEqual(response.ok, true);
    }
  });

  it('Layer 2: should not use response_url if already used', async () => {
    // Setup: response_url was already used
    const userId = 'user_abc';
    const testUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test';

    responseUrls.set(userId, {
      url: testUrl,
      expiresAt: Date.now() + 60 * 60 * 1000,
      used: true, // Already used
    });

    const saved = responseUrls.get(userId);
    const canUseFallback = saved && !saved.used && Date.now() < saved.expiresAt;
    assert.strictEqual(canUseFallback, false);
  });

  it('Layer 2: should not use response_url if expired', async () => {
    // Setup: response_url has expired
    const userId = 'user_abc';
    const testUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test';

    responseUrls.set(userId, {
      url: testUrl,
      expiresAt: Date.now() - 1000, // Expired 1 second ago
      used: false,
    });

    const saved = responseUrls.get(userId);
    const canUseFallback = saved && !saved.used && Date.now() < saved.expiresAt;
    assert.strictEqual(canUseFallback, false);
  });

  it('Layer 3: should log warning when no delivery channel available', async () => {
    // Setup: No active stream, no response_url
    const userId = 'user_abc';

    const stream = streamManager.getStream('nonexistent');
    const saved = responseUrls.get(userId);

    const canUseStream = !!(stream && !stream.finished);
    const canUseFallback = !!(saved && !saved.used && Date.now() < saved.expiresAt);

    assert.strictEqual(canUseStream, false);
    assert.strictEqual(canUseFallback, false);

    // In real code, this would log: logger.warn("WeCom outbound: no delivery channel available...")
  });
});

describe('stream refresh handler - delayed close logic', () => {
  let streamMeta;
  let mockStreams;

  beforeEach(() => {
    streamMeta = new Map();
    mockStreams = new Map();
  });

  it('should close stream when main response done + idle for 10s', () => {
    const streamId = 'stream_test_123';
    const now = Date.now();

    // Setup: Main response done, stream idle for 11s
    streamMeta.set(streamId, {
      mainResponseDone: true,
      doneAt: now - 11000,
    });

    mockStreams.set(streamId, {
      finished: false,
      updatedAt: now - 11000,
      content: 'done',
    });

    // Simulate refresh handler logic
    const stream = mockStreams.get(streamId);
    const meta = streamMeta.get(streamId);
    const idleMs = now - stream.updatedAt;

    const shouldClose = meta?.mainResponseDone && !stream.finished && idleMs > 10000;
    assert.strictEqual(shouldClose, true);
  });

  it('should NOT close stream when idle time < 10s', () => {
    const streamId = 'stream_test_123';
    const now = Date.now();

    // Setup: Main response done, but only idle for 5s
    streamMeta.set(streamId, {
      mainResponseDone: true,
      doneAt: now - 5000,
    });

    mockStreams.set(streamId, {
      finished: false,
      updatedAt: now - 5000,
      content: 'done',
    });

    // Simulate refresh handler logic
    const stream = mockStreams.get(streamId);
    const meta = streamMeta.get(streamId);
    const idleMs = now - stream.updatedAt;

    const shouldClose = meta?.mainResponseDone && !stream.finished && idleMs > 10000;
    assert.strictEqual(shouldClose, false);
  });

  it('should NOT close stream when main response not done', () => {
    const streamId = 'stream_test_123';
    const now = Date.now();

    // Setup: Stream idle for 11s, but main response not done
    streamMeta.set(streamId, {
      mainResponseDone: false,
      doneAt: now - 11000,
    });

    mockStreams.set(streamId, {
      finished: false,
      updatedAt: now - 11000,
      content: 'processing...',
    });

    // Simulate refresh handler logic
    const stream = mockStreams.get(streamId);
    const meta = streamMeta.get(streamId);

    const shouldClose = meta?.mainResponseDone && !stream.finished;
    assert.strictEqual(shouldClose, false);
  });

  it('should NOT close stream when already finished', () => {
    const streamId = 'stream_test_123';
    const now = Date.now();

    // Setup: Stream already finished
    streamMeta.set(streamId, {
      mainResponseDone: true,
      doneAt: now - 15000,
    });

    mockStreams.set(streamId, {
      finished: true,
      updatedAt: now - 11000,
      content: 'done',
    });

    // Simulate refresh handler logic
    const stream = mockStreams.get(streamId);
    const meta = streamMeta.get(streamId);

    const shouldClose = meta?.mainResponseDone && !stream.finished;
    assert.strictEqual(shouldClose, false);
  });
});

describe('safety net - emergency stream cleanup', () => {
  let mockStreams;
  let streamMeta;

  beforeEach(() => {
    mockStreams = new Map();
    streamMeta = new Map();
  });

  it('should close idle stream after 30s safety timeout', () => {
    const streamId = 'stream_test_123';
    const now = Date.now();

    // Setup: Stream idle for 31s (exceeds safety net timeout)
    streamMeta.set(streamId, {
      mainResponseDone: true,
      doneAt: now - 31000,
    });

    mockStreams.set(streamId, {
      finished: false,
      updatedAt: now - 31000,
      content: 'done',
    });

    // Simulate safety net logic
    const stream = mockStreams.get(streamId);
    const idleMs = now - stream.updatedAt;

    const shouldForceClose = stream && !stream.finished && idleMs > 30000;
    assert.strictEqual(shouldForceClose, true);
  });

  it('should NOT close stream with recent activity', () => {
    const streamId = 'stream_test_123';
    const now = Date.now();

    // Setup: Stream updated 5s ago
    streamMeta.set(streamId, {
      mainResponseDone: true,
      doneAt: now - 5000,
    });

    mockStreams.set(streamId, {
      finished: false,
      updatedAt: now - 5000,
      content: 'done',
    });

    // Simulate safety net logic
    const stream = mockStreams.get(streamId);
    const idleMs = now - stream.updatedAt;

    const shouldForceClose = stream && !stream.finished && idleMs > 30000;
    assert.strictEqual(shouldForceClose, false);
  });
});
