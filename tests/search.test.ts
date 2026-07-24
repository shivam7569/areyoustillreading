import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

describe('Pagefind search', () => {
  it('generates a pagefind index after build', () => {
    const dir = join(dist, 'pagefind');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith('pagefind') && f.endsWith('.js'))).toBe(true);
  });

  it('wires a search UI on the blog index', () => {
    const html = readFileSync(join(dist, 'blog', 'index.html'), 'utf-8');
    expect(html).toContain('id="search"');
    expect(html).toContain('/pagefind/pagefind-ui.js');
  });
});
