import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVersion } from './version.js';

describe('resolveVersion (#158)', () => {
  it('reports PRO_VERSION, the image tag the chart deploys', () => {
    assert.deepStrictEqual(resolveVersion('1.10.13', '0.0.0'), { version: '1.10.13', isDevBuild: false });
  });

  it('drops a leading v from PRO_VERSION', () => {
    assert.deepStrictEqual(resolveVersion('v1.10.13', '0.0.0'), { version: '1.10.13', isDevBuild: false });
  });

  it('reports the stamped package.json version of the npm package', () => {
    assert.deepStrictEqual(resolveVersion(undefined, '1.10.13'), { version: '1.10.13', isDevBuild: false });
  });

  it('labels an unstamped checkout a development build', () => {
    assert.deepStrictEqual(resolveVersion(undefined, '0.0.0'), { version: '0.0.0-dev', isDevBuild: true });
    assert.deepStrictEqual(resolveVersion('', '0.0.0'), { version: '0.0.0-dev', isDevBuild: true });
  });
});
