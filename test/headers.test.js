import { describe, it, expect } from 'vitest';
import { securityHeaders } from '../next/headers.js';

const get = (headers, key) => headers.find((h) => h.key === key)?.value;

describe('securityHeaders', () => {
  it("default headers include XFO DENY, HSTS, nosniff and CSP frame-ancestors 'none'", () => {
    const h = securityHeaders();
    expect(get(h, 'X-Frame-Options')).toBe('DENY');
    expect(get(h, 'Strict-Transport-Security')).toContain('max-age=63072000');
    expect(get(h, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(h, 'Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(get(h, 'Content-Security-Policy')).toContain("object-src 'none'");
  });

  it('custom frameAncestors drop XFO and appear in CSP', () => {
    const h = securityHeaders({ frameAncestors: ["'self'", 'https://*.sharepoint.com'] });
    expect(get(h, 'X-Frame-Options')).toBeUndefined();
    expect(get(h, 'Content-Security-Policy')).toContain("frame-ancestors 'self' https://*.sharepoint.com");
  });

  it('csp false omits CSP but keeps frame protection via XFO', () => {
    const h = securityHeaders({ csp: false });
    expect(get(h, 'Content-Security-Policy')).toBeUndefined();
    expect(get(h, 'X-Frame-Options')).toBe('DENY');
  });

  it('extraCsp adds sources to a directive', () => {
    const h = securityHeaders({ extraCsp: { 'connect-src': ['https://firestore.googleapis.com'] } });
    expect(get(h, 'Content-Security-Policy')).toMatch(/connect-src 'self' https:\/\/firestore\.googleapis\.com/);
  });
});
