const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { getConfig } = require('react-native-builder-bob/metro-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * `getConfig` (from react-native-builder-bob) wires up the monorepo watch folders
 * and de-duplicates the library's peerDependencies to the example's node_modules,
 * replacing the hand-rolled exclusionList/blacklistRE setup that broke under
 * Metro >= 0.82 (the `metro-config/src/defaults/exclusionList` subpath is no
 * longer exposed by the package `exports` map).
 *
 * @type {import('metro-config').MetroConfig}
 */
module.exports = getConfig(getDefaultConfig(__dirname), {
  root,
  pkg,
  project: __dirname,
});
