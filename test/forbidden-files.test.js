import { describe, it, expect } from 'vitest';
import { findForbiddenFiles } from '../lib/forbidden-files.js';
import { runCli } from '../lib/cli.js';
import '../lib/commands.js';
import { makeIo } from './helpers.js';

describe('findForbiddenFiles', () => {
  it('flags office documents regardless of case and spaces', () => {
    const result = findForbiddenFiles(['01 PROCEDURES/Plan.DOCX', 'a/b.xlsx', 'r.pdf']);
    expect(result).toHaveLength(3);
    for (const r of result) expect(r.reason).toContain('confidential document');
  });

  it('flags env files but allows .env.example', () => {
    const result = findForbiddenFiles(['.env', '.env.local', 'app/.env.production', '.env.example']);
    expect(result.map((r) => r.path)).toEqual(['.env', '.env.local', 'app/.env.production']);
  });

  it('flags key material and service accounts', () => {
    const result = findForbiddenFiles(['k.pem', 'c.p12', 'sa/serviceAccount-prod.json', 'service_account.json']);
    expect(result).toHaveLength(4);
  });

  it('allows normal source', () => {
    expect(findForbiddenFiles(['src/a.ts', 'package.json', 'README.md', 'environment.ts'])).toEqual([]);
  });
});

describe('check-files command', () => {
  it('check-files exits 1 and names offender', async () => {
    const io = makeIo();
    expect(await runCli(['check-files', 'x.docx'], io)).toBe(1);
    expect(io.err).toContain('x.docx');
  });

  it('check-files exits 0 for clean paths', async () => {
    const io = makeIo();
    expect(await runCli(['check-files', 'src/a.ts'], io)).toBe(0);
  });
});
