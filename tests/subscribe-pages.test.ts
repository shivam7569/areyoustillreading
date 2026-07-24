import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const read = (p: string) => readFileSync(join(dist, p), 'utf-8');
const exists = (p: string) => existsSync(join(dist, p));

describe('subscribe UI', () => {
  it('renders the subscribe form on the homepage', () => {
    const html = read('index.html');
    expect(html).toContain('action="/api/subscribe"');
    expect(html).toContain('name="email"');
  });

  it('builds all subscribe result pages', () => {
    for (const p of ['check-inbox', 'subscribed', 'unsubscribed', 'subscribe-error']) {
      expect(exists(`${p}/index.html`)).toBe(true);
    }
  });
});
