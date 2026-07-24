import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const home = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf-8');

describe('base layout + nav', () => {
  it('renders nav links to every top-level section', () => {
    for (const href of ['/blog', '/projects', '/resume']) {
      expect(home).toContain(`href="${href}"`);
    }
  });

  it('bundles the global stylesheet', () => {
    // Astro either inlines critical CSS in a <style> tag or links a bundled sheet.
    expect(home).toMatch(/<style|rel="stylesheet"/);
  });

  it('renders the site footer', () => {
    expect(home).toContain('areyoustillreading');
  });
});
