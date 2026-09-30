import { describe, it, expect } from 'vitest';
import { upsertManagedBlock, BEGIN_MARKER, END_MARKER } from '../lib/managed-block.js';

describe('upsertManagedBlock', () => {
  it('uses the exact markers from the spec', () => {
    expect(BEGIN_MARKER).toBe('<!-- BEGIN oneup4real/engineering-standards (managed, do not edit) -->');
    expect(END_MARKER).toBe('<!-- END oneup4real/engineering-standards -->');
  });

  it('creates file content when existing is null', () => {
    expect(upsertManagedBlock(null, 'RULES')).toBe(`${BEGIN_MARKER}\nRULES\n${END_MARKER}\n`);
  });

  it('appends block when markers absent and preserves content', () => {
    const existing = '# My Project\n\nCustom rule.\n';
    const result = upsertManagedBlock(existing, 'RULES');
    expect(result.startsWith(existing)).toBe(true);
    expect(result).toContain(`${BEGIN_MARKER}\nRULES\n${END_MARKER}`);
  });

  it('appends after content that lacks a trailing newline', () => {
    const result = upsertManagedBlock('# Title', 'RULES');
    expect(result.startsWith('# Title\n')).toBe(true);
  });

  it('replaces only the block when markers present', () => {
    const existing = `before\n${BEGIN_MARKER}\nOLD\n${END_MARKER}\nafter\n`;
    const result = upsertManagedBlock(existing, 'NEW');
    expect(result).toBe(`before\n${BEGIN_MARKER}\nNEW\n${END_MARKER}\nafter\n`);
    expect(result).not.toContain('OLD');
  });

  it('is idempotent', () => {
    const once = upsertManagedBlock('# P\n', 'RULES');
    expect(upsertManagedBlock(once, 'RULES')).toBe(once);
  });

  it('preserves CRLF line endings when input uses CRLF', () => {
    const existing = '# P\r\n\r\nText\r\n';
    const result = upsertManagedBlock(existing, 'A\nB');
    expect(result.startsWith(existing)).toBe(true);
    expect(result.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('throws on a begin marker without end marker instead of guessing', () => {
    expect(() => upsertManagedBlock(`x\n${BEGIN_MARKER}\nbroken`, 'R')).toThrow(/END marker/);
  });
});
