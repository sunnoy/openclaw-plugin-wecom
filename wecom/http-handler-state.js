/**
 * Shared flag that tracks whether the legacy wildcard HTTP handler was
 * successfully registered via api.registerHttpHandler().
 *
 * When true, gateway.startAccount must NOT also register via
 * registerPluginHttpRoute — the latter places the path into
 * registry.httpRoutes which causes shouldEnforceGatewayAuthForPluginPath
 * → isRegisteredPluginHttpRoutePath to return true → gateway auth
 * enforcement runs → WeCom webhook callbacks (which carry msg_signature,
 * not Bearer tokens) get blocked with 401.
 *
 * This module is intentionally separate from index.js to avoid circular
 * ESM imports (index.js ↔ wecom/channel-plugin.js).
 */
let _wildcardHttpHandlerRegistered = false;

export function markWildcardHttpHandlerRegistered() {
  _wildcardHttpHandlerRegistered = true;
}

export function isWildcardHttpHandlerRegistered() {
  return _wildcardHttpHandlerRegistered;
}
