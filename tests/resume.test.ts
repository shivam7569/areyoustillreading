import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'dist', 'resume', 'index.html');

describe('resume page', () => {
  it('builds', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('shows the real name and a PDF download link', () => {
    const html = readFileSync(file, 'utf-8');
    expect(html).toContain('Shivam Chaudhary');
    expect(html).toContain('href="/resume.pdf"');
    expect(html).toContain('Experience');
  });
});
