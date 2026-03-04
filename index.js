import { logger } from "./logger.js";
import { streamManager } from "./stream-manager.js";
import { wecomChannelPlugin } from "./wecom/channel-plugin.js";
import { wecomHttpHandler } from "./wecom/http-handler.js";
import { responseUrls, setOpenclawConfig, setRuntime, streamMeta } from "./wecom/state.js";

// Periodic cleanup for streamMeta and expired responseUrls to prevent memory leaks.
setInterval(() => {
  const now = Date.now();
  // Clean streamMeta entries whose stream no longer exists in streamManager.
  for (const streamId of streamMeta.keys()) {
    if (!streamManager.hasStream(streamId)) {
      streamMeta.delete(streamId);
    }
  }
  // Clean expired responseUrls (older than 1 hour).
  for (const [key, entry] of responseUrls.entries()) {
    if (now > entry.expiresAt) {
      responseUrls.delete(key);
    }
  }
}, 60 * 1000).unref();

const plugin = {
  // Plugin id should match `openclaw.plugin.json` id (and config.plugins.entries key).
  id: "wecom",
  name: "Enterprise WeChat",
  description: "Enterprise WeChat AI Bot channel plugin for OpenClaw",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api) {
    logger.info("WeCom plugin registering...");

    // Save runtime for message processing
    setRuntime(api.runtime);
    setOpenclawConfig(api.config);

    // Register channel
    api.registerChannel({ plugin: wecomChannelPlugin });
    logger.info("WeCom channel registered");

    // Register HTTP handler for webhooks.
    // OpenClaw 2026.3.2+ removed registerHttpHandler; the primary route
    // registration now happens in gateway.startAccount via registerPluginHttpRoute.
    // Keep the legacy handler for backward compatibility with older versions.
    if (typeof api.registerHttpHandler === "function") {
      api.registerHttpHandler(wecomHttpHandler);
      logger.info("WeCom HTTP handler registered (legacy wildcard)");
    } else {
      logger.info("WeCom: registerHttpHandler unavailable, routes registered via gateway lifecycle");
    }
  },
};

export default plugin;
export const register = (api) => plugin.register(api);
