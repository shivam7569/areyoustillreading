import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('markdown rendering', () => {
  it('syntax-highlights fenced code with Shiki', () => {
    // Astro wraps Shiki output in <pre class="astro-code ...">.
    expect(html).toContain('astro-code');
  });

  it('shows an estimated reading time', () => {
    expect(html).toMatch(/\d+ min read/);
  });
});
