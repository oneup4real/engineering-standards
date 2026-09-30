// Reads the per-project .standardsrc.json.
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {{ bundleForbiddenMarkers?: string[], bundleDir?: string, updateMode?: 'review'|'auto'|'never' }} StandardsConfig
 */

/**
 * @param {string} dir
 * @returns {Promise<StandardsConfig>}
 */
export async function readStandardsConfig(dir) {
  const file = path.join(dir, '.standardsrc.json');
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return {};
    throw new Error(`Could not read ${file}: ${/** @type {Error} */ (error).message}`, { cause: error });
  }
}
