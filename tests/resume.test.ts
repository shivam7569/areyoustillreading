import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const file = join(process.cwd(), 'dist', 'resume', 'index.html');
describe('resume page', () => {
  it('builds', () => { expect(existsSync(file)).toBe(true); });
  it('has a heading and a PDF download link', () => {
    const html = readFileSync(file, 'utf-8');
    expect(html).toMatch(/Resume/);
    expect(html).toContain('href="/resume.pdf"');
  });
});
