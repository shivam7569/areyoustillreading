import { execSync } from 'node:child_process';

// Runs once before the whole Vitest suite. `npm run build` = astro build +
// pagefind index; a green build is itself the first gate, and the .test.ts
// files then assert on the emitted dist/ output.
export default function setup() {
  execSync('npm run build', { stdio: 'inherit' });
}
