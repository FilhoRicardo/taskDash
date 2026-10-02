import { readFileSync, statSync } from 'node:fs';

export function validateReleaseTag(tag, version) {
  const normalizedTag = tag.startsWith('v') ? tag.slice(1) : tag;
  if (normalizedTag !== version) {
    throw new Error(`Tag ${tag} does not match package version ${version}`);
  }
}

export function validateVersions(packageJson, lock, manifest, versions) {
  const version = packageJson.version;
  if (lock.name !== packageJson.name || lock.packages?.['']?.name !== packageJson.name
    || lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json root name/version does not match package.json');
  }
  if (manifest.version !== version) {
    throw new Error('manifest.json version does not match package.json');
  }
  if (versions[version] !== manifest.minAppVersion) {
    throw new Error('versions.json current entry does not match manifest.json minAppVersion');
  }
}

function main() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

  validateVersions(packageJson, lock, manifest, versions);
  const tag = process.argv[2];
  if (tag) validateReleaseTag(tag, packageJson.version);

  for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    if (statSync(file).size === 0) throw new Error(`${file} is empty`);
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
