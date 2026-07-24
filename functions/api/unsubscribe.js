import { isUuid, unsubscribeByToken, redirect } from '../../lib/email.js';

// GET /api/unsubscribe?token=... — one-click unsubscribe.
// Always lands on /unsubscribed (non-enumerating, user-friendly).
export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');
  if (isUuid(token)) {
    try {
      await unsubscribeByToken(env, token);
    } catch {
      // fall through to the friendly page regardless
    }
  }
  return redirect('/unsubscribed');
}
