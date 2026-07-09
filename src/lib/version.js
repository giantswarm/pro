/**
 * Version utility
 *
 * Reads the version from package.json so it stays in sync
 * with the npm package version and autorelease workflow.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgPath = join(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

export const version = pkg.version;
export const name = pkg.name;
