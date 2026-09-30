// Security headers preset for next.config: `headers: async () => [{ source: '/:path*', headers: securityHeaders() }]`.

/**
 * @param {{
 *   frameAncestors?: string[],
 *   csp?: boolean,
 *   extraCsp?: Record<string, string[]>,
 *   dev?: boolean,
 *   firebase?: boolean,
 * }} [options]
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders({ frameAncestors = ["'none'"], csp = true, extraCsp = {}, dev = process.env.NODE_ENV !== 'production', firebase = false } = {}) {
  const denyFraming = frameAncestors.length === 1 && frameAncestors[0] === "'none'";
  const headers = [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  // X-Frame-Options cannot express an allow-list, so it is only sent when framing is denied entirely.
  if (denyFraming) headers.push({ key: 'X-Frame-Options', value: 'DENY' });

  if (csp) {
    /** @type {Record<string, string[]>} */
    const directives = {
      'default-src': ["'self'"],
      // Next.js inlines bootstrap scripts; move to nonces when the project is ready for it.
      'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'connect-src': ["'self'"],
      'frame-ancestors': frameAncestors,
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
    };
    if (firebase) {
      // Firebase client SDK: Firestore/Auth/Storage APIs, Realtime DB websockets, and the auth helper iframe.
      directives['connect-src'].push('https://*.googleapis.com', 'https://*.firebaseio.com', 'wss://*.firebaseio.com', 'https://*.cloudfunctions.net');
      directives['frame-src'] = [...(directives['frame-src'] ?? ["'self'"]), 'https://*.firebaseapp.com'];
      directives['img-src'].push('https://firebasestorage.googleapis.com');
    }
    for (const [directive, sources] of Object.entries(extraCsp)) {
      directives[directive] = [...(directives[directive] ?? []), ...sources];
    }
    const value = Object.entries(directives).map(([d, s]) => `${d} ${s.join(' ')}`).join('; ');
    headers.push({ key: 'Content-Security-Policy', value });
  }
  return headers;
}
