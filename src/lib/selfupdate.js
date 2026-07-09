/**
 * Self-update functionality
 *
 * Checks for the latest release of pro on GitHub and updates the
 * current installation if a newer version is found.
 *
 * Modeled after the Go self-update pattern in mcp-kubernetes,
 * adapted for Node.js.
 */

import { execFileSync } from 'node:child_process';
import { version } from './version.js';
import { logger } from './logger.js';

const GITHUB_REPO = 'giantswarm/pro';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Compare two semver strings.
 * Returns true if remote is greater than local.
 */
function isNewer(localVersion, remoteVersion) {
  const local = localVersion.replace(/^v/, '').split('.').map(Number);
  const remote = remoteVersion.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if ((remote[i] || 0) > (local[i] || 0)) return true;
    if ((remote[i] || 0) < (local[i] || 0)) return false;
  }
  return false;
}

/**
 * Perform the self-update.
 * Checks GitHub releases for a newer version, downloads the npm tarball,
 * and installs it globally.
 */
export async function selfUpdate() {
  const currentVersion = version;

  if (!currentVersion || currentVersion === 'dev' || currentVersion === '0.0.0') {
    throw new Error('Cannot self-update a development version');
  }

  logger.info(`Current version: ${currentVersion}`);
  logger.info('Checking for updates...');

  // Fetch latest release from GitHub (use token if available for private repos)
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': `pro/${currentVersion}`,
  };
  const token = process.env.GITHUB_API_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(GITHUB_API_URL, { headers });

  if (!response.ok) {
    throw new Error(`Failed to check for updates: ${response.status} ${response.statusText}`);
  }

  const release = await response.json();
  const latestVersion = release.tag_name;

  if (!latestVersion) {
    throw new Error(`Could not determine latest version from ${GITHUB_REPO}`);
  }

  if (!isNewer(currentVersion, latestVersion)) {
    logger.info('Current version is the latest.');
    return;
  }

  logger.info(`Found newer version: ${latestVersion} (published at ${release.published_at})`);

  // Look for the npm tarball in release assets
  const tarballAsset = release.assets?.find(a => a.name.endsWith('.tgz'));

  if (tarballAsset) {
    // Download and install from the release tarball
    logger.info(`Downloading ${tarballAsset.name}...`);
    const downloadUrl = tarballAsset.browser_download_url;

    try {
      execFileSync('npm', ['install', '-g', downloadUrl], { stdio: 'inherit' });
      logger.info(`Successfully updated to version ${latestVersion}`);
    } catch (error) {
      throw new Error(`Update failed: ${error.message}`);
    }
  } else {
    // Fallback: install directly from the GitHub repo tag
    logger.info(`Installing from GitHub tag ${latestVersion}...`);

    try {
      execFileSync(
        'npm',
        ['install', '-g', `github:${GITHUB_REPO}#${latestVersion}`],
        { stdio: 'inherit' }
      );
      logger.info(`Successfully updated to version ${latestVersion}`);
    } catch (error) {
      throw new Error(`Update failed: ${error.message}`);
    }
  }
}
