import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { validateReleaseTag, validateVersions } from '../../scripts/validate-release.mjs';

const packageJson = { name: 'taskdash-2-2', version: '2.2.0' };
const lock = {
  name: 'taskdash-2-2',
  version: '2.2.0',
  packages: { '': { name: 'taskdash-2-2', version: '2.2.0' } },
};
const manifest = { version: '2.2.0', minAppVersion: '1.5.0' };
const versions = { '2.2.0': '1.5.0' };

describe('release validation', () => {
  it('keeps CI and release gates running lint', () => {
    expect(fs.readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('npm run lint');
    expect(fs.readFileSync('.github/workflows/release.yml', 'utf8')).toContain('npm run lint');
  });
  it('accepts an npm-default v-prefixed release tag', () => {
    expect(() => validateReleaseTag('v2.2.0', '2.2.0')).not.toThrow();
  });

  it('accepts an unprefixed release tag', () => {
    expect(() => validateReleaseTag('2.2.0', '2.2.0')).not.toThrow();
  });

  it('rejects tags that do not exactly match the package version after one v', () => {
    expect(() => validateReleaseTag('v2.2.1', '2.2.0')).toThrow(/does not match/);
    expect(() => validateReleaseTag('vv2.2.0', '2.2.0')).toThrow(/does not match/);
  });

  it('accepts consistent package, lock, manifest, and versions data', () => {
    expect(() => validateVersions(packageJson, lock, manifest, versions)).not.toThrow();
  });

  it('rejects any package, lock, manifest, or versions mismatch', () => {
    expect(() => validateVersions({ ...packageJson, version: '2.2.1' }, lock, manifest, versions)).toThrow(/package.json/);
    expect(() => validateVersions(packageJson, { ...lock, packages: { '': { ...lock.packages[''], version: '2.2.1' } } }, manifest, versions)).toThrow(/package-lock.json/);
    expect(() => validateVersions(packageJson, lock, { ...manifest, version: '2.2.1' }, versions)).toThrow(/manifest.json/);
    expect(() => validateVersions(packageJson, lock, manifest, { '2.2.0': '1.7.2' })).toThrow(/versions.json/);
  });
});
