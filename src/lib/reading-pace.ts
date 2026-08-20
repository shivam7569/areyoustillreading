/*
 * src/lib/reading-pace.ts — the reader's own reading pace.
 * ---------------------------------------------------------------------------
 * Every reading time on the site is an estimate at BASE = 200 words per minute.
 * Almost nobody reads at exactly that, so the homepage "A measurement" section
 * lets a reader time themselves on one real paragraph. The measured pace is only
 * ADOPTED — used to re-price the reading times shown to them — once they consent;
 * until then everyone sees the honest 200-wpm default. The choice is per reader,
 * kept in localStorage on their own device (nothing recorded server-side).
 *
 *   BASE          the wpm the published reading_min values assume (200).
 *   getPace()     { base, wpm, adopted } — wpm is the last measured value or null.
 *   displayMin(n) n is a reading_min computed at BASE; returns the reader's own
 *                 minutes when they've adopted a pace, else n unchanged.
 *   setMeasured   store a fresh measurement (does NOT adopt it).
 *   adopt/unadopt turn personalisation on/off (requires a stored measurement).
 *   onPaceChange  subscribe to adopt/unadopt so a page can re-price live.
 *
 * The whole thing degrades to the 200-wpm default if localStorage is unavailable.
 */

export const BASE = 200;
const WPM_KEY = 'ays.wpm';       // last measured words-per-minute (number)
const ON_KEY = 'ays.pace.on';    // '1' when the reader has consented to use it
export const PACE_EVENT = 'ays:pace';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode — stay on the default */ } };
const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* no-op */ } };

// A believable human reading pace; anything outside is a fumble (interrupted, skimming) we ignore.
export const isSanePace = (wpm: number) => Number.isFinite(wpm) && wpm >= 70 && wpm <= 900;

export interface Pace { base: number; wpm: number | null; adopted: boolean; }

export function getPace(): Pace {
  const raw = Number(read(WPM_KEY));
  const wpm = isSanePace(raw) ? Math.round(raw) : null;
  const adopted = wpm != null && read(ON_KEY) === '1';
  return { base: BASE, wpm, adopted };
}

// Re-price a BASE-wpm reading_min into the reader's own minutes (min 1). Left untouched
// unless they've measured AND adopted a pace, so the default view is the honest 200-wpm one.
export function displayMin(baseMin: number | null | undefined): number {
  const n = Math.max(0, Math.round(Number(baseMin) || 0));
  const { wpm, adopted } = getPace();
  if (!adopted || !wpm) return Math.max(1, n);
  return Math.max(1, Math.round(n * BASE / wpm));
}

// Store a measurement without adopting it — the reader is asked separately whether to use it.
export function setMeasured(wpm: number) {
  if (!isSanePace(wpm)) return;
  write(WPM_KEY, String(Math.round(wpm)));
}

function emit() {
  try { window.dispatchEvent(new CustomEvent(PACE_EVENT, { detail: getPace() })); } catch { /* no window */ }
}

// Consent: from now on, show reading times at the reader's measured pace. No-op without a
// sane stored measurement (nothing to adopt).
export function adopt(): boolean {
  const raw = Number(read(WPM_KEY));
  if (!isSanePace(raw)) return false;
  write(ON_KEY, '1');
  emit();
  return true;
}

// Back to the shared 200-wpm default (keeps the measurement, just stops using it).
export function unadopt() {
  drop(ON_KEY);
  emit();
}

// Re-price every reading-time element under `root` to the reader's pace. Any page bakes its
// reading times as `<span data-read-min="12" data-read-unit="min read">12 min read</span>` (the
// base 200-wpm value + its label); this rewrites the text to displayMin(base). A no-op visually
// until the reader adopts a pace, so it is always safe to run. Elements re-injected at runtime
// (feed rows) just call this again on their container after each render.
export function repriceReadMins(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-read-min]').forEach((el) => {
    const base = Number(el.getAttribute('data-read-min'));
    if (!Number.isFinite(base)) return;
    const unit = el.getAttribute('data-read-unit') || 'min';
    el.textContent = `${displayMin(base)} ${unit}`;
  });
}

// Subscribe to adopt/unadopt. Returns an unsubscribe fn.
export function onPaceChange(cb: (p: Pace) => void): () => void {
  const h = () => cb(getPace());
  try { window.addEventListener(PACE_EVENT, h); } catch { /* no window */ }
  return () => { try { window.removeEventListener(PACE_EVENT, h); } catch { /* no-op */ } };
}
