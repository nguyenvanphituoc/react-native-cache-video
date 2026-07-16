import { registerRootComponent } from 'expo';

import App from './src/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the environment for both `expo run:*` (dev-client) and prebuild native builds.
registerRootComponent(App);
