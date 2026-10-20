export type ProjectKind = 'launch-store' | 'expo' | 'react-native' | 'swift' | 'kotlin';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const FILE_KINDS: ReadonlyArray<readonly [RegExp, ProjectKind]> = [
  [/^launch\.config\.(ts|mjs|js)$/, 'launch-store'],
  [/^app\.config\.(ts|js|mjs|json)$/, 'expo'],
  [/^(Package\.swift|.+\.xcodeproj|.+\.xcworkspace|ios)$/, 'swift'],
  [/^((build|settings)\.gradle(\.kts)?|android)$/, 'kotlin'],
];

const PACKAGE_KINDS: ReadonlyArray<readonly [string, ProjectKind]> = [
  ['expo', 'expo'],
  ['react-native', 'react-native'],
];

const parseManifest = (manifestText: string): PackageManifest => {
  try {
    const manifest = JSON.parse(manifestText);
    if (manifest === null) return {};
    if (typeof manifest !== 'object') return {};
    return manifest;
  } catch {
    return {};
  }
};

export const projectKinds = (entryNames: readonly string[], manifestText: string) => {
  const manifest = parseManifest(manifestText);
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const dependencyNames = Object.keys(dependencies);
  const fileKinds = FILE_KINDS.filter(([pattern]) =>
    entryNames.some((entryName) => pattern.test(entryName)),
  ).map(([, kind]) => kind);
  const packageKinds = PACKAGE_KINDS.filter(([packageName]) =>
    dependencyNames.includes(packageName),
  ).map(([, kind]) => kind);
  const kinds = new Set([...fileKinds, ...packageKinds]);
  return [...kinds];
};
