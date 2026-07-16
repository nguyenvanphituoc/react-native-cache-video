// Metro config for the Expo example inside this yarn-workspaces monorepo.
//
// NOTE: builder-bob's `getConfig` (used by the bare `example/`) targets the RN CLI and relies
// on Metro APIs removed in 0.82, so we use Expo's own monorepo pattern here: watch the
// workspace root, resolve from both node_modules trees, and de-dup React/React Native to the
// app's copy so the library (resolved from ../src via react-native.config.js) shares one React.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the workspace root so edits to the library `src` trigger a rebuild.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// 3. De-dup singletons — the library must use the app's React / React Native, not a second copy.
config.resolver.extraNodeModules = {
  'react': path.resolve(projectRoot, 'node_modules', 'react'),
  'react-native': path.resolve(projectRoot, 'node_modules', 'react-native'),
};

module.exports = config;
