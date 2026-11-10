const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const entry = path.resolve(__dirname, 'tests/native-fixture/index.tsx');
if (process.env.ENTRY_FILE && path.resolve(process.env.ENTRY_FILE) === entry && process.env.BIRBFORGE_NATIVE_FIXTURE !== '1') {
  throw new Error('Native fixture entry requires BIRBFORGE_NATIVE_FIXTURE=1');
}
if (process.env.BIRBFORGE_NATIVE_FIXTURE === '1') {
  if (!process.env.ENTRY_FILE || path.resolve(process.env.ENTRY_FILE) !== entry) {
    throw new Error('Native fixture requires its explicit ENTRY_FILE');
  }
  const previousResolver = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform !== 'ios') throw new Error('Native fixture supports only the iOS acceptance build');
    if ((context.originModulePath === path.resolve(__dirname, 'app/App.tsx') && moduleName === './src/transport') ||
        (context.originModulePath === path.resolve(__dirname, 'app/src/GoalWorkflows.tsx') && moduleName === './transport')) {
      return {type: 'sourceFile', filePath: path.resolve(__dirname, 'tests/native-fixture/transport.native.ts')};
    }
    return (previousResolver ?? context.resolveRequest)(context, moduleName, platform);
  };
}
module.exports = config;
