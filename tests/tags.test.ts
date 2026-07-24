import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
const exists = (p: string) => existsSync(join(dist, p));

describe('blog tags', () => {
  it('builds a per-tag page listing its posts', () => {
    expect(exists('blog/tags/meta/index.html')).toBe(true);
    expect(read('blog/tags/meta/index.html')).toContain('Hello, world');
  });

  it('builds a tags index listing the tag', () => {
    expect(exists('blog/tags/index.html')).toBe(true);
    expect(read('blog/tags/index.html')).toContain('meta');
  });

  it('links tags from the post page', () => {
    expect(read('blog/hello-world/index.html')).toContain('/blog/tags/meta');
  });
});
