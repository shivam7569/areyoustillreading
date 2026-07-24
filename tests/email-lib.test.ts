import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain JS shared module (no type declarations)
import { isValidEmail, normalizeEmail, isUuid } from '../lib/email.js';

describe('email lib (pure logic)', () => {
  it('validates email addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('x.y+z@sub.domain.io')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.co')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });

  it('normalizes emails (trim + lowercase)', () => {
    expect(normalizeEmail('  A@B.CO ')).toBe('a@b.co');
  });

  it('validates UUID tokens', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
