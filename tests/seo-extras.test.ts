import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

describe('SEO extras', () => {
  it('emits robots.txt pointing at the sitemap', () => {
    const p = join(dist, 'robots.txt');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf-8')).toContain('sitemap-index.xml');
  });

  it('builds a styled 404 page', () => {
    const p = join(dist, '404.html');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf-8')).toContain('404');
  });
});
