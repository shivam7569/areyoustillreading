/**
 * lib/inert-guard.js — a fail-closed backstop that rejects executable HTML.
 * ============================================================================
 * WHAT / WHY
 *   The author's Markdown is rendered + sanitized IN THE BROWSER by the shared
 *   pipeline (src/lib/render-post-browser.mjs → markdownConfig, whose rehype-sanitize
 *   pass strips script / on-handlers / iframe / javascript: BEFORE the trusted
 *   D2/Plotly/KaTeX transforms add their SVG/JSON). So normal editor output is already
 *   inert. This guard is the SERVER-SIDE BACKSTOP for /api/author/publish: it makes a
 *   hand-crafted POST that bypasses the editor fail, WITHOUT re-running the heavy render
 *   (too heavy for workerd) and WITHOUT a blanket re-sanitize (which would strip the
 *   legitimate D2 SVG + Plotly JSON — the sanitize must run mid-pipeline).
 *
 * APPROACH — parse with the BROWSER'S OWN PARSER, walk, reject on any executable node.
 *   The body_html is parsed to a node tree with parse5 (the spec-compliant HTML parser
 *   that hast/rehype use under the hood — pure JS, runs in workerd, no DOM/DOMParser).
 *   parse5 sees the markup EXACTLY as the reader's browser will: it decodes character
 *   references in attribute values, treats `/`-separated and control-split attributes the
 *   way the browser does, descends into `<foreignObject>` XHTML and `<template>` content,
 *   and puts `<noscript>`/raw-text elements in their true shape. So the walk cannot be
 *   fooled by the entity-encoding and parser-quirk tricks that defeat a regex scan
 *   (`<svg/onload=…>`, `href="java&#115;cript:…"`, an `onclick` buried in a foreignObject).
 *
 *   It is an ALLOW-GOOD / REJECT-DANGEROUS check, not a transform: it throws on the first
 *   executable construct and otherwise leaves the trusted D2 <svg>, the inert Plotly
 *   `<script type="application/json">` data island, KaTeX/MathML, and Shiki spans untouched.
 *   It rejects, it never edits. A parse failure fails CLOSED (rejects).
 *
 * SCOPE: appropriate for INVITE-ONLY (semi-trusted) authors and, because it matches the
 *   browser's parse, is a hard barrier against a bypass-the-editor POST. The remaining
 *   Phase-4 ("lock-the-cage") work is orthogonal: a separate cookieless serving origin so
 *   that even a novel bypass cannot reach the reader's session on the main origin.
 */
import { parseFragment } from 'parse5';

export class InertError extends Error {
  constructor(message) { super(message); this.name = 'InertError'; }
}

// Elements that can load, execute, reframe, or exfiltrate — none of which the markdown
// pipeline ever emits (the D2 SVG, Plotly JSON island, KaTeX/MathML, and Shiki output
// contain none of these). <script> is handled separately (an inert application/json
// island is the one allowed form). `template`/`noscript` are blocked because their
// contents parse under different rules (a classic mutation-XSS laundering path); the SVG
// SMIL animation elements are blocked because `<set attributeName="href" to="javascript:…">`
// retargets a link to a script URL, and D2's static export emits none of them.
const BLOCKED_ELEMENTS = new Set([
  'iframe', 'object', 'embed', 'form', 'base', 'frame', 'frameset', 'applet',
  'meta', 'link', 'portal', 'marquee', 'noscript', 'template',
  'animate', 'animatetransform', 'animatemotion', 'set',
]);

// Attributes whose value is a URL — vetted for dangerous schemes. Raw parse5 attribute
// names, so both the HTML forms and the namespaced SVG `xlink:href` are listed.
const URL_ATTRS = new Set([
  'href', 'xlink:href', 'src', 'srcset', 'srcdoc', 'action', 'formaction', 'data',
  'poster', 'background', 'ping', 'cite', 'longdesc', 'usemap', 'manifest', 'profile',
]);

// True if a URL attribute value carries a script-bearing scheme. The value is already
// entity-decoded by parse5; strip ASCII whitespace + C0 control chars first (the URL parser
// ignores them when resolving a scheme, so `java\tscript:` and ` javascript:` both count).
// `data:` is allowed for inert media (images/fonts) but rejected for the markup types that
// execute when navigated to (html/xhtml/xml/svg).
function isDangerousUrl(value) {
  const v = String(value == null ? '' : value).replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (/^(?:javascript|vbscript|livescript|mocha):/.test(v)) return true;
  if (/^data:(?:text\/html|application\/(?:xhtml|xml)|image\/svg)/.test(v)) return true;
  return false;
}

function assertNodeInert(node) {
  const children = node.childNodes || [];
  for (const el of children) {
    const tag = el.tagName; // undefined for #text / #comment / #document-type nodes
    if (tag) {
      const name = tag.toLowerCase();
      const attrs = el.attrs || [];

      if (name === 'script') {
        // Allow ONLY the inert application/json data island (the Plotly figure JSON the
        // reader's trusted client island parses); any other <script> executes.
        const typeAttr = attrs.find((a) => a.name.toLowerCase() === 'type');
        const type = typeAttr ? typeAttr.value.trim().toLowerCase() : '';
        if (type !== 'application/json') throw new InertError('executable <script> is not allowed');
      } else if (BLOCKED_ELEMENTS.has(name)) {
        throw new InertError(`disallowed element <${name}>`);
      }

      for (const a of attrs) {
        const an = a.name.toLowerCase();
        // Any on* attribute is an event handler (parse5 only reports one where the browser
        // would fire one — no false positives from `/`-separated or unquoted markup).
        if (/^on[a-z]/.test(an)) throw new InertError(`inline event handler ${an} is not allowed`);
        if (URL_ATTRS.has(an) && isDangerousUrl(a.value)) throw new InertError('dangerous URL scheme is not allowed');
      }
    }
    // <template> is blocked above, but recurse defensively in case a future edit unblocks it:
    // its real children live in `.content`, not `.childNodes`.
    if (el.content) assertNodeInert(el.content);
    assertNodeInert(el);
  }
}

/**
 * Throw InertError if `html` contains any executable construct; return true if inert.
 * A parse failure (malformed beyond parse5's tolerance) fails CLOSED.
 * @param {string} html  the caller-rendered body_html to vet
 */
export function assertInert(html) {
  const raw = String(html == null ? '' : html);
  let tree;
  try {
    tree = parseFragment(raw);
  } catch {
    throw new InertError('content could not be parsed for vetting');
  }
  assertNodeInert(tree);
  return true;
}
