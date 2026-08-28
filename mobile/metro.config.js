// Metro must be told about the parent directory explicitly.
//
// The shared core (../src/lib/mobile) sits outside this package. Metro only
// watches the project root by default, so without watchFolders an import of
// @shared/* resolves in TypeScript — giving green typechecks — and then fails
// at runtime with "Unable to resolve module". The two must agree, which is
// why the tsconfig path and this entry are commented as a pair.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(repoRoot, "src", "lib")];

// Resolution order matters: the app's own node_modules first, so that a
// duplicated dependency in the web app cannot shadow the React Native copy —
// two copies of React in one bundle produce hook errors that read as
// application bugs.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

config.resolver.extraNodeModules = {
  "@shared": path.resolve(repoRoot, "src", "lib"),
};

// The web app is a Next.js project; its files must never be pulled into the
// native bundle.
config.resolver.blockList = [
  new RegExp(`${path.resolve(repoRoot, "src", "app").replace(/[\\\\]/g, "\\\\\\\\")}.*`),
  new RegExp(`${path.resolve(repoRoot, ".next").replace(/[\\\\]/g, "\\\\\\\\")}.*`),
];

module.exports = config;
