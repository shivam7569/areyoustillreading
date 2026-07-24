import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('comments', () => {
  it('renders a comments section wired to the post id', () => {
    expect(html).toContain('Comments');
    expect(html).toContain('data-post-id="hello-world"');
  });
});
