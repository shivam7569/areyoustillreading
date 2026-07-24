import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('private notes', () => {
  it('renders the private note editor on posts', () => {
    expect(html).toContain('Your private note');
    expect(html).toContain('id="note-body"');
  });
});
