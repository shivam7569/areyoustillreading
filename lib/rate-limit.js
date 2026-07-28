/**
 * lib/rate-limit.js — a tiny KV-backed fixed-window per-IP rate limiter.
 * ============================================================================
 * Uses the already-bound POSTS_HTML KV namespace. Keys are `rl:<name>:<ip>:<win>`
 * with a TTL equal to the window, so they self-expire (no cleanup).
 *
 * FAIL-OPEN by design: if KV is missing/errors (or its write quota is exhausted
 * under an extreme flood), the limiter ALLOWS the request rather than breaking the
 * endpoint. So it caps casual/moderate abuse without ever taking the site down.
 * KV has no atomic increment, so a burst can under-count slightly across the edge —
 * fine for abuse control (not a billing counter).
 *
 * NOTE on volume: each ALLOWED request does one KV put (free tier ~1k writes/day).
 * Use generous limits on high-traffic endpoints; for hard edge protection at scale,
 * pair this with a Cloudflare Rate-Limiting (WAF) rule, which runs before Functions.
 */

// The client IP from Cloudflare's trusted edge header.
export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

/**
 * @returns {Promise<{ ok: boolean, retryAfter?: number }>} ok:false when over limit.
 */
export async function rateLimit(env, name, ip, limit, windowSec) {
  const kv = env.POSTS_HTML;
  if (!kv) return { ok: true }; // no store → fail open
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const key = `rl:${name}:${ip}:${win}`;
  try {
    const cur = parseInt((await kv.get(key)) || '0', 10) || 0;
    if (cur >= limit) return { ok: false, retryAfter: windowSec - (now % windowSec) };
    // Only allowed requests write; a blocked flood then costs reads, not writes.
    await kv.put(key, String(cur + 1), { expirationTtl: windowSec + 5 });
    return { ok: true };
  } catch {
    return { ok: true }; // KV error / quota → fail open
  }
}
