/**
 * lib/inert-guard.js — a fail-closed backstop that rejects executable HTML.
 * ============================================================================
 * WHAT / WHY
 *   The author's Markdown is rendered + sanitized IN THE BROWSER by the shared
 *   pipeline (src/lib/render-post-browser.mjs → markdownConfig, whose rehype-sanitize
 *   pass strips script / on-handlers / iframe / javascript: BEFORE the trusted D2/Plotly/KaTeX
 *   transforms add their SVG/JSON). So normal editor output is already inert. This
 *   guard is the SERVER-SIDE BACKSTOP for the /api/author/publish endpoint: it makes
 *   a hand-crafted POST that bypasses the editor fail, WITHOUT re-running the heavy
 *   render (too heavy for workerd) and WITHOUT a blanket re-sanitize (which would
 *   strip the legitimate D2 SVG + Plotly JSON — the sanitize must run mid-pipeline).
 *
 * APPROACH — allow-good / reject-dangerous SCAN (not a transform):
 *   It scans the final body_html and THROWS on any executable construct, while
 *   leaving the trusted D2 <svg>, the inert Plotly `<script type="application/json">`
 *   data island, KaTeX spans and Shiki spans untouched. It rejects, it never edits.
 *   Tag/handler/scheme detection is on the LITERAL string: entity-encoded forms
 *   (`&lt;script&gt;`, prose containing "javascript:") are inert text and correctly
 *   do NOT match — so this never false-positives on ordinary prose or code samples.
 *
 * SCOPE (Phase 3 posture): appropriate for INVITE-ONLY (semi-trusted) authors. It is
 *   deliberately NOT a complete XSS sanitizer — exotic entity-encoded scheme tricks in
 *   a non-editor POST are out of scope here; Phase 4 ("lock-the-cage") replaces this
 *   with authoritative isolated rendering + a separate cookieless serving origin.
 */

export class InertError extends Error {
  constructor(message) { super(message); this.name = 'InertError'; }
}

/**
 * Throw InertError if `html` contains any executable construct; return true if inert.
 * @param {string} html  the caller-rendered body_html to vet
 */
export function assertInert(html) {
  const raw = String(html == null ? '' : html);
  // Lowercase for case-insensitive matching. (No need to strip control chars: an HTML
  // parser won't treat a control-split "<scr[NUL]ipt>" as a script tag, so it can't
  // execute — the literal-string scans below are the right granularity.)
  const s = raw.toLowerCase();

  // 1) <script> — allow ONLY an inert application/json data island (the Plotly figure
  //    JSON the reader's trusted client island parses). Any other <script> executes.
  for (const m of s.matchAll(/<script\b([^>]*)>/g)) {
    if (!/\btype\s*=\s*["']?\s*application\/json\b/.test(m[1])) {
      throw new InertError('executable <script> is not allowed');
    }
  }

  // 2) inline event handlers (onclick=, onerror=, onload=, …) on any element.
  if (/<[a-z][^>]*\son[a-z]+\s*=/.test(s)) {
    throw new InertError('inline event handler is not allowed');
  }

  // 3) dangerous URL schemes as an ATTRIBUTE VALUE (the `=` requirement means a bare
  //    "javascript:" in prose text never matches — only href/src="javascript:…" etc.).
  if (/=\s*["']?\s*(?:(?:javascript|vbscript)\s*:|data:\s*text\/html)/.test(s)) {
    throw new InertError('dangerous URL scheme is not allowed');
  }

  // 4) elements that can load, execute, reframe, or exfiltrate.
  if (/<\s*(?:iframe|object|embed|form|base|frame|frameset|applet|meta|link|portal|marquee)\b/.test(s)) {
    throw new InertError('disallowed element');
  }

  return true;
}
