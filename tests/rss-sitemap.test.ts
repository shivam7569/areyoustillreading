import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

describe('RSS feed', () => {
  it('emits /rss.xml listing the post', () => {
    const p = join(dist, 'rss.xml');
    expect(existsSync(p)).toBe(true);
    const xml = readFileSync(p, 'utf-8');
    expect(xml).toContain('<rss');
    expect(xml).toContain('Hello, world');
    expect(xml).toContain('/blog/hello-world');
  });
});

describe('sitemap', () => {
  it('emits a sitemap index', () => {
    // @astrojs/sitemap outputs sitemap-index.xml (+ sitemap-0.xml).
    expect(existsSync(join(dist, 'sitemap-index.xml'))).toBe(true);
  });
});
