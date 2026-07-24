import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
const exists = (p: string) => existsSync(join(dist, p));

describe('blog pipeline', () => {
  it('lists the post on the blog index', () => {
    expect(exists('blog/index.html')).toBe(true);
    const html = read('blog/index.html');
    expect(html).toContain('Hello, world');
    expect(html).toContain('/blog/hello-world');
  });

  it('renders the post markdown to HTML', () => {
    expect(exists('blog/hello-world/index.html')).toBe(true);
    const html = read('blog/hello-world/index.html');
    expect(html).toContain('<h1>Hello, world</h1>');
    expect(html).toContain('A heading');
    expect(html).toContain('<li>one</li>');
  });
});
