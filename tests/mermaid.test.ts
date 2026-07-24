import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(
  join(process.cwd(), 'dist', 'blog', 'hello-world', 'index.html'),
  'utf-8'
);

describe('Mermaid diagrams', () => {
  it('renders the mermaid fence to inline SVG at build time', () => {
    expect(html).toContain('<svg');
    // A node label from the diagram must be present inside the rendered SVG.
    expect(html).toContain('Prompt');
  });

  it('ships no client-side mermaid runtime', () => {
    expect(html).not.toMatch(/mermaid(\.min)?\.js|mermaid\.initialize/);
  });
});
