/**
 * scripts/_shared.mjs — shared setup for the Phase-1 content scripts.
 * ============================================================================
 * Phase 1 keeps the `content` schema UNEXPOSED to PostgREST (shadow posture), so
 * these server-side dev scripts reach it over a DIRECT Postgres connection (pg),
 * not the Supabase REST client. The Supabase Auth admin API (SUPABASE_URL +
 * service-role key) is used only to mint/remove dummy auth.users for load tests.
 *
 * ENV (put in a local .env you never commit, or export in your shell):
 *   DATABASE_URL              Supabase Postgres connection string
 *                             (Dashboard → Project Settings → Database → Connection string).
 *   SUPABASE_URL              https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY service-role key (Auth admin API; NEVER ship to a client)
 *   LOADTEST_PASSWORD         optional; password set on dummy users (default below)
 *
 * These scripts are DEV/OPS tooling — run locally against your dev database only.
 */
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

/** Load a local .env (KEY=VALUE lines) into process.env without adding a dep. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env', '.dev.vars']) {
  const p = path.join(__root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const ROOT = __root;
export const LT = { domain: 'loadtest.invalid', prefix: 'lt-', password: process.env.LOADTEST_PASSWORD || 'LoadTest!2026' };

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`\n  Missing required env var: ${name}\n  See scripts/README.md for setup.\n`); process.exit(1); }
  return v;
}

/** A pg Pool to the Supabase Postgres (SSL required). Reuse one per script. */
export function getPool() {
  const { Pool } = pg;
  return new Pool({ connectionString: requireEnv('DATABASE_URL'), ssl: { rejectUnauthorized: false }, max: 8 });
}

/** Supabase client with the service-role key — used ONLY for the Auth admin API. */
export function getAdminSupabase() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Resolve the single site owner (first row of public.admins). Exits if none. */
export async function resolveOwner(pool) {
  const { rows } = await pool.query('select user_id from public.admins order by created_at asc nulls first limit 1');
  if (!rows.length) {
    console.error('\n  No owner found in public.admins.\n  Sign in once, then insert your user_id into public.admins (see db/highlights.sql), and re-run.\n');
    process.exit(1);
  }
  const ownerId = rows[0].user_id;
  const meta = await pool.query("select raw_user_meta_data->>'name' as name from auth.users where id = $1", [ownerId]);
  return { ownerId, penName: (meta.rows[0] && meta.rows[0].name) || '' };
}

/** Split a raw .md file into { frontmatterRaw, body }. */
export function splitMd(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw || '');
  return m ? { body: raw.slice(m[0].length) } : { body: raw || '' };
}

/** Cheap plaintext + reading-time from rendered HTML (for FTS + the "N min" label). */
export function textAndReadingMin(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  return { text, readingMin: Math.max(1, Math.ceil(words / 200)) };
}

export const args = (() => {
  const o = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { o[k] = v; i++; } else o[k] = true; }
  }
  return o;
})();
