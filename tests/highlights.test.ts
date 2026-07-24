import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('highlights', () => {
  it('renders the highlights + discussion section and save button', () => {
    expect(html).toContain('Highlights');
    expect(html).toContain('id="hl-save-btn"');
  });
});
