const path = require('path');

// In-repo dogfood only: yarn does not symlink the root workspace package into
// example-expo/node_modules (the root package declares itself with a `"*"` range), so RN
// autolinking can't find the native module by name. Root-map it to the repo root here.
//
// A real npm consumer needs NONE of this — the package resolves from their node_modules and
// autolinks normally.
module.exports = {
  dependencies: {
    'react-native-cache-video': {
      root: path.resolve(__dirname, '..'),
    },
  },
};
