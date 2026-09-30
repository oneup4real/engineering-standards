// Scans built client JavaScript for markers of confidential data (seed records, internal IDs, secrets).
import fs from 'node:fs/promises';
import path from 'node:path';

export class BundleDirError extends Error {}

/**
 * @param {{ path: string, content: string }[]} files
 * @param {string[]} markers
 * @returns {{ path: string, marker: string }[]}
 */
export function scanForMarkers(files, markers) {
  /** @type {{ path: string, marker: string }[]} */
  const hits = [];
  for (const file of files) {
    for (const marker of markers) {
      if (file.content.includes(marker)) hits.push({ path: file.path, marker });
    }
  }
  return hits;
}

/**
 * @param {{ dir: string, markers: string[] }} opts
 * @returns {Promise<{ path: string, marker: string }[]>}
 */
export async function checkBundle({ dir, markers }) {
  let jsFiles;
  try {
    jsFiles = await listJsFiles(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new BundleDirError(`Build directory "${dir}" does not exist. Run the production build first.`);
    }
    throw error;
  }
  if (jsFiles.length === 0) {
    throw new BundleDirError(`Build directory "${dir}" contains no .js files. Run the production build first.`);
  }
  const files = await Promise.all(jsFiles.map(async (p) => ({ path: p, content: await fs.readFile(p, 'utf8') })));
  return scanForMarkers(files, markers);
}

/** @param {string} dir */
async function listJsFiles(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join(e.parentPath, e.name));
}
