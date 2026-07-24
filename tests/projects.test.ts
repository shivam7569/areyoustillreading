import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'dist', 'projects', 'index.html');

describe('projects page', () => {
  it('builds', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('renders a projects heading and at least one project card', () => {
    const html = readFileSync(file, 'utf-8');
    expect(html).toMatch(/Projects/);
    // at least one project name from the placeholder array should appear
    expect(html).toContain('Context Ledger');
  });
});
