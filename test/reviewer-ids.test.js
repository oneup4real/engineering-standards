import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const REVIEWERS = [
  { heading: '### Architecture', file: 'arch-review.md', prefix: 'ARCH' },
  { heading: '### UI', file: 'ui-review.md', prefix: 'UI' },
  { heading: '### Logic', file: 'logic-review.md', prefix: 'LOGIC' },
  { heading: '### Security', file: 'security-review.md', prefix: 'SEC' },
  { heading: '### Test quality', file: 'test-quality.md', prefix: 'TQ' },
];

const ids = (text, prefix) => [...new Set([...text.matchAll(new RegExp(`\\b${prefix}-\\d+\\b`, 'g'))].map((m) => m[0]))].sort();

/** README text of one "What each reviewer checks" subsection. */
function section(readme, heading) {
  const start = readme.indexOf(`\n${heading}`);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const end = rest.slice(heading.length).search(/\n(?:### |## |---)/);
  return end < 0 ? rest : rest.slice(0, heading.length + end);
}

describe('README reviewer rules cite the ids of the reviewer reference files', () => {
  for (const { heading, file, prefix } of REVIEWERS) {
    it(`${prefix}: README and ${file} carry the same ids`, async () => {
      const readme = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8');
      const reference = await fs.readFile(path.join(ROOT, 'skills/factory-review/references', file), 'utf8');
      const fromReadme = ids(section(readme, heading), prefix);
      const fromReference = ids(reference, prefix);
      expect(fromReference.length).toBeGreaterThan(0);
      expect(fromReadme).toEqual(fromReference);
    });
  }
});
