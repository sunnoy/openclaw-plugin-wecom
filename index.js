import { logger } from "./logger.js";
import { streamManager } from "./stream-manager.js";
import { wecomChannelPlugin } from "./wecom/channel-plugin.js";
import { wecomHttpHandler } from "./wecom/http-handler.js";
import { responseUrls, setOpenclawConfig, setRuntime, streamMeta } from "./wecom/state.js";

function emptyPluginConfigSchema() {
  return {
    safeParse(value) {
      if (value === undefined) return { success: true, data: undefined };
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { success: false, error: { message: "expected config object" } };
      }
      return { success: true, data: value };
    },
  };
}

let cleanupTimer = null;

const plugin = {
  id: "wecom",
  name: "Enterprise WeChat",
  description: "Enterprise WeChat AI Bot channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    logger.info("WeCom plugin registering...");

    setRuntime(api.runtime);
    setOpenclawConfig(api.config);

    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const streamId of streamMeta.keys()) {
        if (!streamManager.hasStream(streamId)) {
          streamMeta.delete(streamId);
        }
      }
      for (const [key, entry] of responseUrls.entries()) {
        if (now > entry.expiresAt) {
          responseUrls.delete(key);
        }
      }
    }, 60_000);
    cleanupTimer.unref();

    api.registerChannel({ plugin: wecomChannelPlugin });
    logger.info("WeCom channel registered");

    api.registerHttpRoute({
      path: "/webhooks",
      handler: wecomHttpHandler,
      auth: "plugin",
      match: "prefix",
    });
    logger.info("WeCom HTTP route registered (auth: plugin, match: prefix)");
  },
};

export default plugin;
export const register = (api) => plugin.register(api);
