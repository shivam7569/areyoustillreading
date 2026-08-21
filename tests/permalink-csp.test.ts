/**
 * tests/permalink-csp.test.ts — the CSP + security headers for edge-rendered permalink pages
 * (lib/permalink-headers.js + the nonce path in lib/assemble-permalink.js).
 *
 * WHAT THIS FILE IS
 * -----------------
 * The permalink pages (/@handle, /@handle/slug, /s/…, /f/…) are built as fresh Function Responses
 * in functions/_middleware.js, and Cloudflare Pages does NOT apply the static _headers file to
 * Function responses — so these pages get their security headers ONLY from lib/permalink-headers.js.
 * This suite pins that behaviour so a regression cannot silently ship the core reader pages with a
 * weakened (or missing) policy:
 *   - the full security-header set is present,
 *   - the POST page's script-src carries a per-request nonce and DROPS 'unsafe-inline' (the CSP
 *     backstop to the inert-guard: a script that ever slipped the guard cannot execute),
 *   - every first-party script in the shell is stamped with that nonce, while an injected author
 *     <script> is NOT — so it is blocked,
 *   - the CDN host allowlist is retained and there is no 'strict-dynamic' (so plotly.js / Turnstile
 *     keep loading), and
 *   - the shared directives stay byte-for-byte in sync with public/_headers.
 *
 * It reads the REAL built shell (dist/permalink-shell/index.html), produced once by globalSetup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemblePermalinkHtml } from '../lib/assemble-permalink.js';
import { renderNonce, securityHeaders, nonceScripts } from '../lib/permalink-headers.js';

const shell = readFileSync('dist/permalink-shell/index.html', 'utf8');
const shellScriptCount = (shell.match(/<script\b/gi) || []).length;

const scriptSrcOf = (csp: string) =>
  csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) || '';

describe('permalink-headers: nonce stamping', () => {
  it('the built shell has scripts to protect', () => {
    expect(shellScriptCount).toBeGreaterThan(0);
  });

  it('nonceScripts stamps every <script> in the shell', () => {
    const n = renderNonce();
    const out = nonceScripts(shell, n);
    const nonced = (out.match(new RegExp(`<script nonce="${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length;
    expect(nonced).toBe(shellScriptCount);
    // closing tags untouched
    expect(out).not.toContain('</script nonce');
  });

  it('assemblePermalinkHtml nonces the shell but NOT the injected author body', () => {
    const n = renderNonce();
    const row: any = {
      title: 'T', description: 'D', post_id: '11111111-1111-1111-1111-111111111111',
      primary_handle: 'auth', primary_name: 'Author', slug: 'p', pub_date: '2026-08-21T00:00:00Z',
      reading_min: 5, tags: [], authors: [{ handle: 'auth', name: 'Author' }],
      body_html: '<p>Body.</p><script type="application/json" class="plotly-json">{"data":[]}</script><script>alert(document.cookie)</script>',
    };
    const html = assemblePermalinkHtml(shell, row, '/@auth/p', 'https://s/@auth/p', n);
    // shell scripts nonced
    const nonced = (html.match(new RegExp(`<script nonce="${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length;
    expect(nonced).toBe(shellScriptCount);
    // author scripts NOT nonced → the injected <script> stays verbatim and cannot execute
    expect(html).toContain('<script>alert(document.cookie)</script>');
    expect(html).not.toContain(`<script nonce="${n}">alert(document.cookie)`);
    // the inert Plotly island survives (un-nonced, but type=application/json never executes)
    expect(html).toContain('<script type="application/json" class="plotly-json">');
  });

  it('renderNonce is random per call', () => {
    expect(renderNonce()).not.toBe(renderNonce());
  });
});

describe('permalink-headers: policy shape', () => {
  it('post page (with nonce): strict script-src, no unsafe-inline, no strict-dynamic, CDNs kept', () => {
    const n = renderNonce();
    const h = securityHeaders(n);
    const ss = scriptSrcOf(h['Content-Security-Policy']);
    expect(ss).toContain(`'nonce-${n}'`);
    expect(ss).not.toContain("'unsafe-inline'");
    expect(h['Content-Security-Policy']).not.toContain('strict-dynamic');
    expect(ss).toContain('https://cdn.plot.ly');
    expect(ss).toContain('https://challenges.cloudflare.com');
    // eval kept so plotly.js / legacy libs don't break
    expect(ss).toContain("'unsafe-eval'");
  });

  it('escaped-data pages (no nonce): standard policy keeps unsafe-inline, no nonce', () => {
    const ss = scriptSrcOf(securityHeaders()['Content-Security-Policy']);
    expect(ss).toContain("'unsafe-inline'");
    expect(ss).not.toContain('nonce-');
  });

  it('full security-header set is present', () => {
    const h = securityHeaders(renderNonce());
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(h['Permissions-Policy']).toContain('geolocation=()');
  });

  it('non-script directives stay byte-for-byte in sync with public/_headers', () => {
    const headersFile = readFileSync('public/_headers', 'utf8');
    const line = headersFile.split('\n').find((l) => l.includes('Content-Security-Policy')) || '';
    const baseline = line.split('Content-Security-Policy:')[1].trim();
    const norm = (c: string) =>
      c.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('script-src')).sort().join(' | ');
    expect(norm(securityHeaders()['Content-Security-Policy'])).toBe(norm(baseline));
  });
});
