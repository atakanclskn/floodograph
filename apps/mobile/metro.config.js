// Monorepo Metro config. Expo SDK 52+ already watches the workspace root and resolves hoisted
// packages, so @floodograph/core (packages/core) is picked up without extra watchFolders.
//
// One extra rule: apps/web pins `react@latest` at the root, while React Native's renderer needs the
// exact React version Expo ships (installed in apps/mobile/node_modules). Hoisted packages such as
// react-native would otherwise resolve the root copy and we would bundle two Reacts. Every
// `react` / `react-dom` import is therefore resolved as if it came from this app.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const PINNED = ["react", "react-dom"];
const anchor = path.join(__dirname, "package.json");
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = PINNED.some((p) => moduleName === p || moduleName.startsWith(`${p}/`));
  const ctx = pinned ? { ...context, originModulePath: anchor } : context;
  return upstream ? upstream(ctx, moduleName, platform) : context.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
