/**
 * src/lib/admin-format.ts — small shared formatters for the admin dashboard UI.
 * Client-side only. Keeps number/money/date/HTML-escaping consistent across every
 * /admin page (one source, so the studio reads the same everywhere).
 */

export const fmtNum = (n: number): string => new Intl.NumberFormat('en-US').format(Number(n) || 0);

export function fmtMoney(cents: number, currency = 'usd'): string {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function fmtDate(s?: string): string {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
  if (isNaN(d.valueOf())) return s;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relTime(s?: string): string {
  if (!s) return '';
  const d = new Date(s);
  const diff = (Date.now() - d.valueOf()) / 1000;
  if (isNaN(diff)) return '';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(s);
}

/** HTML-escape any value before interpolating it into innerHTML (XSS guard for the
 *  many places we build rows from user-authored data — titles, emails, comments). */
export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
