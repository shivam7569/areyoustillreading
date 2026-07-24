import { execSync } from 'node:child_process';

// Runs once before the whole Vitest suite. A green production build is itself
// the first gate; the .test.ts files then assert on the emitted dist/ output.
export default function setup() {
  execSync('npx astro build', { stdio: 'inherit' });
}
