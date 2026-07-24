import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'dist', 'projects', 'index.html');

describe('projects page', () => {
  it('builds', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('renders the real project', () => {
    const html = readFileSync(file, 'utf-8');
    expect(html).toMatch(/Projects/);
    expect(html).toContain('Deep-Learning Architectures from Scratch');
  });
});
