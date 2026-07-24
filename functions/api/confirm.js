import { isUuid, confirmByToken, redirect } from '../../lib/email.js';

// GET /api/confirm?token=... — completes double opt-in.
export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');
  if (!isUuid(token)) return redirect('/subscribe-error');
  try {
    const ok = await confirmByToken(env, token);
    return redirect(ok ? '/subscribed' : '/subscribe-error');
  } catch {
    return redirect('/subscribe-error');
  }
}
