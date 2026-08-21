/**
 * lib/permalink-headers.js — security headers + a per-request CSP nonce for the edge-rendered
 * permalink pages (/@handle, /@handle/slug, /s/…, /f/…).
 * ============================================================================
 * WHY THIS EXISTS
 *   These pages are built as fresh Function `Response`s in functions/_middleware.js. Cloudflare
 *   Pages does NOT apply the static `_headers` file to Function-generated responses — so without
 *   this helper the permalink pages (the core reader surface now) ship with NO security headers
 *   at all: no CSP, no X-Frame-Options, no HSTS, nothing. `securityHeaders()` restores the full
 *   set that `_headers` gives every static page, so a DB post is no less protected than a file one.
 *
 * THE NONCE (post page only — it injects author-rendered body_html)
 *   The post page's script-src uses a per-request `'nonce-…'` and DROPS `'unsafe-inline'`. The
 *   inert-guard (lib/inert-guard.js) is the primary barrier against a bypass-the-editor POST; this
 *   CSP is the backstop: a `<script>` / on* handler / javascript: URL the guard ever missed still
 *   cannot execute, because it does not carry the nonce. The first-party inline scripts DO (they
 *   are nonced in the shell before body_html is substituted — see nonceScripts), and the external
 *   CDN scripts (plotly.js from cdn.plot.ly, jsdelivr) keep loading because the host allowlist is
 *   retained and there is NO 'strict-dynamic' (which would have disabled host matching). 'unsafe-
 *   eval'/'wasm-unsafe-eval' stay so plotly.js and other libs don't break. Author/series/field
 *   pages inject only escaped data, so they use the standard (nonce-less) policy.
 */

// The site's baseline directives, kept BYTE-FOR-BYTE in sync with public/_headers so a DB page's
// policy never drifts from a static page's. Only script-src forks (nonce vs unsafe-inline).
const BASE_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://cdn.plot.ly https://challenges.cloudflare.com https://pypi.org https://files.pythonhosted.org",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
];
const CDN_SCRIPT_HOSTS = 'https://cdn.jsdelivr.net https://cdn.plot.ly https://challenges.cloudflare.com';

// Build the Content-Security-Policy. With a nonce: strict script-src (nonce + hosts, no
// 'unsafe-inline', no 'strict-dynamic'). Without: the standard 'unsafe-inline' policy that every
// static page already carries.
function contentSecurityPolicy(nonce) {
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' ${CDN_SCRIPT_HOSTS}`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${CDN_SCRIPT_HOSTS}`;
  return [...BASE_DIRECTIVES, scriptSrc].join('; ');
}

/**
 * A cryptographically-random base64 nonce for one response. workerd exposes Web Crypto.
 * @returns {string}
 */
export function renderNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The full security-header set for an edge-rendered permalink response — mirrors public/_headers
 * (which does not reach Function responses) plus the CSP. Pass a nonce for the author-content
 * (post) page; omit it for the escaped-data pages (author/series/field).
 * @param {string} [nonce]
 * @returns {Record<string,string>}
 */
export function securityHeaders(nonce) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Content-Security-Policy': contentSecurityPolicy(nonce),
  };
}

/**
 * Add nonce="…" to every <script> opening tag in the SHELL so the trusted first-party inline
 * scripts run under the nonce CSP. MUST be applied to the shell BEFORE author body_html is
 * substituted into it, so an injected author <script> never receives the nonce. Closing tags
 * (</script>) are untouched.
 * @param {string} shellHtml
 * @param {string} nonce
 * @returns {string}
 */
export function nonceScripts(shellHtml, nonce) {
  return shellHtml.replace(/<script\b/gi, `<script nonce="${nonce}"`);
}
