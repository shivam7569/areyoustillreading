/**
 * tests/copy-overlay.test.ts
 * =============================================================================
 * Guards the INSTANT copy overlay (lib/site-copy.js + functions/_middleware.js).
 *
 * Two layers:
 *  1. Unit — the pure helpers that decide WHAT gets patched: flattenCopy (the
 *     dot-path address space shared by the Studio editor, the data-cms anchors,
 *     and the edge rewriter), the emphasis/escape renderers, and readFreshCopy's
 *     staleness gate (a stale KV copy must never override a fresher build).
 *  2. Build-output — the global chrome in BaseLayout actually SHIPS its data-cms
 *     anchors into every page (dist/index.html), so the edge rewriter has stable
 *     hooks to target. If an anchor is dropped, that string silently stops going
 *     instant — this catches it before deploy.
 *
 * Pure JS module import (no .d.ts) — mirrors tests/email-lib.test.ts.
 * =============================================================================
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore — plain .js helper, no TypeScript declarations.
import { flattenCopy, escapeHtml, emphHtml, readFreshCopy } from '../lib/site-copy.js';

describe('flattenCopy — dot-path address space', () => {
  it('flattens nested objects to dot paths, string leaves only', () => {
    const out = flattenCopy({ global: { nav: { home: 'Home', blog: 'Blog' }, footer: { tagline: 'Written to be finished.' } } });
    expect(out['global.nav.home']).toBe('Home');
    expect(out['global.nav.blog']).toBe('Blog');
    expect(out['global.footer.tagline']).toBe('Written to be finished.');
  });

  it('indexes arrays numerically', () => {
    const out = flattenCopy({ about: { body: ['first', 'second', 'third'] } });
    expect(out['about.body.0']).toBe('first');
    expect(out['about.body.2']).toBe('third');
  });

  it('skips non-string leaves (numbers/booleans/null) — overlay only replaces text', () => {
    const out = flattenCopy({ a: 'x', n: 42, b: true, z: null, nested: { keep: 'y', drop: 7 } });
    expect(out).toEqual({ a: 'x', 'nested.keep': 'y' });
    expect('n' in out).toBe(false);
    expect('z' in out).toBe(false);
  });

  it('never emits a bare empty key for a top-level string', () => {
    expect(flattenCopy('loose')).toEqual({});
  });
});

describe('escapeHtml / emphHtml — safe text vs. inline emphasis', () => {
  it('escapeHtml neutralises the five HTML-significant characters', () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f');
  });

  it('emphHtml turns *asterisk* into <em> and escapes the rest', () => {
    expect(emphHtml('plain *emphasis* & <tag>')).toBe('plain <em>emphasis</em> &amp; &lt;tag&gt;');
  });

  it('emphHtml leaves a lone/unclosed asterisk untouched (escaped only)', () => {
    expect(emphHtml('2 * 3 = 6')).toBe('2 * 3 = 6');
  });
});

describe('readFreshCopy — KV read + staleness gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  const mkEnv = (raw: string | null) => ({ POSTS_HTML: { get: vi.fn(async () => raw) } });
  const stubBuiltAt = (builtAt: number) => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ builtAt }) }));
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  it('returns null when the binding is missing', async () => {
    expect(await readFreshCopy({}, 'copy:site', 'https://x/')).toBeNull();
  });

  it('returns null on a KV miss (no getBuiltAt subrequest)', async () => {
    const fetchSpy = stubBuiltAt(0);
    const env = mkEnv(null);
    expect(await readFreshCopy(env, 'copy:site', 'https://x/')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // steady state stays a single KV get
  });

  it('serves the KV content when it is newer than the build', async () => {
    stubBuiltAt(1000);
    const env = mkEnv(JSON.stringify({ content: { global: { nav: { home: 'Inicio' } } }, publishedAt: 2000 }));
    const out = await readFreshCopy(env, 'copy:site', 'https://x/');
    expect(out).toEqual({ global: { nav: { home: 'Inicio' } } });
  });

  it('hands back to static once the rebuild has baked the edit in (publishedAt <= builtAt)', async () => {
    stubBuiltAt(5000);
    const env = mkEnv(JSON.stringify({ content: { global: {} }, publishedAt: 2000 }));
    expect(await readFreshCopy(env, 'copy:site', 'https://x/')).toBeNull();
  });

  it('returns null on a malformed entry', async () => {
    stubBuiltAt(0);
    expect(await readFreshCopy(mkEnv('not json'), 'copy:site', 'https://x/')).toBeNull();
    expect(await readFreshCopy(mkEnv(JSON.stringify({ nope: 1 })), 'copy:site', 'https://x/')).toBeNull();
  });
});

describe('build output — global chrome ships its data-cms anchors', () => {
  const home = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf-8');

  it('anchors the brand wordmark', () => {
    expect(home).toContain('data-cms="global.brand.accent"');
    expect(home).toContain('data-cms="global.brand.rest"');
  });

  it('anchors the primary + footer nav labels', () => {
    for (const key of ['home', 'blog', 'series', 'projects', 'resume', 'about', 'account', 'allPosts']) {
      expect(home).toContain(`data-cms="global.nav.${key}"`);
    }
  });

  it('anchors the footer RSS label and the copyline tagline', () => {
    expect(home).toContain('data-cms="global.footer.rss"');
    expect(home).toContain('data-cms="global.footer.tagline"');
  });
});

describe('build output — page-body copy ships its anchors', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'dist', p), 'utf-8');

  it('home body + newsletter (via SubscribeForm) are anchored', () => {
    const home = read('index.html');
    expect(home).toContain('data-cms="home.hero.lede"');
    expect(home).toContain('data-cms="home.newsletter.heading"');
    expect(home).toContain('data-cms="home.newsletter.blurb"');
  });

  it('about headline + body carry the emphasis-aware anchor', () => {
    const about = read('about/index.html');
    expect(about).toContain('data-cms="about.headline"');
    expect(about).toContain('data-cms-rich="emph"'); // rich fields reproduce *emphasis*
  });

  it('the 404 page anchors its heading', () => {
    expect(read('404.html')).toContain('data-cms="notFound.heading"');
  });

  it('every shipped data-cms path resolves to a real site.json key (no typos)', () => {
    // Cross-check: flatten site.json to its string-leaf paths, then assert every
    // data-cms anchor emitted into the home page addresses one of them. A mistyped
    // path would silently fail to ever go instant — catch it at build.
    // @ts-ignore — JSON import.
    const site = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'site.json'), 'utf-8'));
    const valid = new Set(Object.keys(flattenCopy(site)));
    const home = read('index.html');
    const paths = [...home.matchAll(/data-cms="([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(valid.has(p), `unknown site.json path: ${p}`).toBe(true);
  });
});
