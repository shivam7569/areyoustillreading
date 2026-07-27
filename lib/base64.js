/**
 * lib/base64.js — UTF-8 ⇄ base64 for Cloudflare Functions (GitHub blob content).
 * ============================================================================
 * btoa/atob are Latin1-only, so we round-trip through UTF-8 bytes. Crucially the
 * encoder walks the byte array in CHUNKS instead of spreading it into
 * String.fromCharCode(...bytes): the spread passes one argument per byte and blows
 * the argument-count limit (RangeError "Maximum call stack size exceeded") on any
 * post larger than ~125 KB — e.g. one embedding a base64 data-URI image. Shared by
 * functions/api/publish.js, functions/api/admin/post.js, and lib/list-posts.js so
 * every path encodes/decodes identically and safely.
 * ============================================================================
 */

const CHUNK = 0x8000; // 32 KB per String.fromCharCode call — well under the arg limit.

/** Base64 of a UTF-8 string (safe for arbitrarily large content). */
export function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode base64 (e.g. a GitHub blob, which may contain newlines) as UTF-8. */
export function fromBase64Utf8(b64) {
  const binary = atob(String(b64 || '').replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
