import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

describe('dynamic OG images', () => {
  it('generates a PNG for each post', () => {
    const p = join(dist, 'og', 'hello-world.png');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(1000);
  });

  it('references its OG image from the post head', () => {
    const html = readFileSync(join(dist, 'blog', 'hello-world', 'index.html'), 'utf-8');
    expect(html).toContain('/og/hello-world.png');
  });
});
