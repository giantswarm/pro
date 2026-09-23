/**
 * Version utility
 *
 * The release tag is the single source of truth for versions; package.json
 * stays at 0.0.0 in git. Each distribution carries the tag its own way:
 *
 * - the container image: the Helm chart sets PRO_VERSION to the image tag it
 *   deploys (its appVersion, which the release build sets from the tag),
 * - the npm package: the Publish package workflow stamps package.json from
 *   the tag before packing.
 *
 * A checkout has neither and reports 0.0.0-dev.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgPath = join(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const UNSTAMPED = '0.0.0';

/**
 * Resolve the version the server reports.
 *
 * @param {string | undefined} envVersion - PRO_VERSION
 * @param {string} pkgVersion - the package.json version
 * @returns {{ version: string, isDevBuild: boolean }}
 */
export function resolveVersion(envVersion, pkgVersion) {
  if (envVersion) {
    return { version: envVersion.replace(/^v/, ''), isDevBuild: false };
  }
  if (pkgVersion !== UNSTAMPED) {
    return { version: pkgVersion, isDevBuild: false };
  }
  return { version: `${UNSTAMPED}-dev`, isDevBuild: true };
}

export const { version, isDevBuild } = resolveVersion(process.env.PRO_VERSION, pkg.version);
export const name = pkg.name;
