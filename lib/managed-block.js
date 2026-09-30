// Inserts or replaces a marker-delimited block in a text file, leaving everything else untouched.

export const BEGIN_MARKER = '<!-- BEGIN oneup4real/engineering-standards (managed, do not edit) -->';
export const END_MARKER = '<!-- END oneup4real/engineering-standards -->';

/**
 * @param {string | null} existing current file content, or null if the file does not exist
 * @param {string} block content to place between the markers (LF line endings)
 * @returns {string}
 */
export function upsertManagedBlock(existing, block) {
  const eol = existing && existing.includes('\r\n') ? '\r\n' : '\n';
  const body = [BEGIN_MARKER, block.replace(/\r?\n$/, ''), END_MARKER].join('\n').replaceAll('\n', eol);

  if (existing === null) return body + eol;

  const start = existing.indexOf(BEGIN_MARKER);
  if (start === -1) {
    const separator = existing.length === 0 || existing.endsWith(eol) ? '' : eol;
    const spacer = existing.length === 0 ? '' : eol;
    return existing + separator + spacer + body + eol;
  }

  const endIndex = existing.indexOf(END_MARKER, start);
  if (endIndex === -1) {
    throw new Error(`Found the BEGIN marker but no END marker ("${END_MARKER}"); fix the file by hand.`);
  }
  return existing.slice(0, start) + body + existing.slice(endIndex + END_MARKER.length);
}
