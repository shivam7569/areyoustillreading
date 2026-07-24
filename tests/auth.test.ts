import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');

describe('auth pages', () => {
  it('builds the login page with both sign-in methods', () => {
    const html = read('login/index.html');
    expect(html).toContain('name="email"');
    expect(html).toContain('GitHub');
  });

  it('builds the account page', () => {
    expect(existsSync(join(dist, 'account', 'index.html'))).toBe(true);
  });

  it('links Account in the nav', () => {
    expect(read('index.html')).toContain('href="/account"');
  });
});
