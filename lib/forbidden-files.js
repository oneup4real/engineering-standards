// Detects files that must never be committed: confidential documents, env files and key material.
import path from 'node:path';

const DOCUMENT_EXTENSIONS = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.pdf'];
const KEY_EXTENSIONS = ['.pem', '.p12', '.pfx', '.key'];
const SERVICE_ACCOUNT_RE = /service[-_]?account.*\.json$/i;

/**
 * @param {string[]} paths repository-relative paths
 * @param {{ ignore?: string[] }} [options]
 * @returns {{ path: string, reason: string }[]}
 */
export function findForbiddenFiles(paths, options = {}) {
  const ignorePatterns = options.ignore ?? [];
  /** @type {{ path: string, reason: string }[]} */
  const offenders = [];
  for (const p of paths) {
    if (isIgnored(p, ignorePatterns)) continue;
    const reason = reasonFor(p);
    if (reason) offenders.push({ path: p, reason });
  }
  return offenders;
}

/**
 * @param {string} filePath
 * @param {string[]} patterns
 */
export function isIgnored(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  for (const pattern of patterns) {
    const p = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
    if (p === normalized) return true;
    if (p.endsWith('/*') && normalized.startsWith(p.slice(0, -1))) return true;
    if (p.endsWith('/**') && normalized.startsWith(p.slice(0, -2))) return true;
    const regexStr = '^' + p
      .replace(/[.+^$${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*')
      .replace(/\?/g, '.') + '$';
    try {
      if (new RegExp(regexStr, 'i').test(normalized)) return true;
    } catch {
      // fallback
    }
  }
  return false;
}

/** @param {string} p */
function reasonFor(p) {
  const base = path.posix.basename(p.replaceAll('\\', '/')).toLowerCase();
  const ext = path.posix.extname(base);
  if (DOCUMENT_EXTENSIONS.includes(ext)) {
    return 'confidential document (office/PDF files belong in a document system, not git)';
  }
  if (KEY_EXTENSIONS.includes(ext)) return 'private key or certificate material';
  if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') {
    return 'environment file (may contain secrets; commit .env.example instead)';
  }
  if (SERVICE_ACCOUNT_RE.test(base)) return 'cloud service-account credentials';
  return null;
}
