import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const home = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf-8');

describe('homepage', () => {
  it('surfaces the latest posts', () => {
    expect(home).toContain('Latest posts');
    expect(home).toContain('/blog/hello-world');
  });

  it('includes the subscribe form', () => {
    expect(home).toContain('action="/api/subscribe"');
  });
});
