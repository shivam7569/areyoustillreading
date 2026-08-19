/**
 * scripts/apply-sql.mjs — apply a .sql file to the dev database via pg.
 * ============================================================================
 * Convenience for the DB-backed migrations that don't need the Supabase SQL
 * editor. Runs the whole file in one connection (DO blocks / functions / grants
 * all supported by the simple-query protocol). DEV ONLY.
 *
 *   node scripts/apply-sql.mjs db/content-serve.sql
 */
import fs from 'node:fs';
import { getPool } from './_shared.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-sql.mjs <file.sql>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`not found: ${file}`); process.exit(1); }

const pool = getPool();
try {
  await pool.query(fs.readFileSync(file, 'utf8'));
  console.log(`applied ${file}`);
} catch (e) {
  console.error(`FAILED ${file}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
