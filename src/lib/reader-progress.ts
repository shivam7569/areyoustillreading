/**
 * src/lib/reader-progress.ts — client helpers for per-reader reading position.
 * ===========================================================================
 * The browser talks straight to Supabase (anon key + RLS on public.reader_progress),
 * the same way Notes/Highlights do — no Pages Function in the path. Every call is a
 * no-op for a signed-out reader, so callers can invoke these unconditionally.
 *
 * Powers: "Continue" on the field + series (first unfinished part) and the read-marks
 * in the arc / parts list / in-post spine. Requires db/reader-progress.sql to be run.
 */
import { supabase } from './supabase';

export type Progress = { pct: number; read: boolean };

/** The signed-in reader's id, or null. */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** This reader's progress for a set of post slugs → Map<slug, {pct, read}> (empty when signed out). */
export async function fetchProgress(slugs: string[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  const wanted = [...new Set(slugs.filter(Boolean))];
  if (!wanted.length) return out;
  const uid = await currentUserId();
  if (!uid) return out;
  try {
    const { data } = await supabase.from('reader_progress').select('post_slug,pct,read').in('post_slug', wanted);
    for (const r of (data as any[]) || []) out.set(r.post_slug, { pct: r.pct, read: r.read });
  } catch {
    /* table missing / offline — treat as no progress */
  }
  return out;
}

/** Record the reader's furthest position in a post (upsert on the PK). No-op when signed out. */
export async function recordProgress(slug: string, pct: number, read: boolean): Promise<void> {
  if (!slug) return;
  const uid = await currentUserId();
  if (!uid) return;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  try {
    await supabase.from('reader_progress').upsert(
      { user_id: uid, post_slug: slug, pct: p, read, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,post_slug' },
    );
  } catch {
    /* best-effort */
  }
}
