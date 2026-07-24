import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), 'dist', p), 'utf-8');

describe('SEO / OpenGraph', () => {
  for (const page of ['index.html', 'blog/hello-world/index.html']) {
    it(`emits OG + Twitter + canonical on ${page}`, () => {
      const html = read(page);
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('name="twitter:card"');
      expect(html).toContain('rel="canonical"');
    });
  }
});
