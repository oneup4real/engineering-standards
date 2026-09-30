// Detects files that must never be committed: confidential documents, env files and key material.
import path from 'node:path';

const DOCUMENT_EXTENSIONS = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.pdf'];
const KEY_EXTENSIONS = ['.pem', '.p12', '.pfx', '.key'];
const SERVICE_ACCOUNT_RE = /service[-_]?account.*\.json$/i;

/**
 * @param {string[]} paths repository-relative paths
 * @returns {{ path: string, reason: string }[]}
 */
export function findForbiddenFiles(paths) {
  /** @type {{ path: string, reason: string }[]} */
  const offenders = [];
  for (const p of paths) {
    const reason = reasonFor(p);
    if (reason) offenders.push({ path: p, reason });
  }
  return offenders;
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
