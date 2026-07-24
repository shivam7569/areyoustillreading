import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');

// A distinctive sentence that lives only in the gated body of premium-example.md.
const GATED = 'must never appear';

describe('paywall content protection', () => {
  it('keeps the gated body OUT of the public post page (shows preview instead)', () => {
    const pub = read('blog/premium-example/index.html');
    expect(pub).not.toContain(GATED);
    expect(pub).toContain('free teaser'); // preview is public
  });

  it('renders the full body ONLY in the gated route, marked no-index', () => {
    const gated = read('gated/premium-example/index.html');
    expect(gated).toContain(GATED);
    expect(gated).toContain('data-pagefind-ignore');
  });

  it('does not leak the gated body into the blog listing, RSS, or sitemap', () => {
    expect(read('blog/index.html')).not.toContain(GATED);
    expect(read('rss.xml')).not.toContain(GATED);
    expect(read('sitemap-0.xml')).not.toContain('/gated/');
  });
});
