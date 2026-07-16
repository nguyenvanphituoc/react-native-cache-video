// Expo config plugin entry for react-native-cache-video.
// Ships the compiled plugin so `npx expo prebuild` can `require()` it directly.
// Source: plugin/src/index.ts → built to plugin/build/index.js via `yarn build:plugin`.
module.exports = require('./plugin/build/index.js').default;
