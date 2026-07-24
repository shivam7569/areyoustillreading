import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

describe('build smoke test', () => {
  it('emits a homepage', () => {
    const file = join(dist, 'index.html');
    expect(existsSync(file)).toBe(true);
    const html = readFileSync(file, 'utf-8');
    expect(html).toContain('<html');
    expect(html.length).toBeGreaterThan(50);
  });
});
