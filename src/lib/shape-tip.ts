/*
 * src/lib/shape-tip.ts — the reading-shape hover tooltip, shared by the home feed and /blog.
 * ---------------------------------------------------------------------------
 * A single fixed card that reads `data-shape` off the hovered `.curve` SVG and shows the
 * on-brand reading-shape line (see shapeText() in feed-render.ts). The native <title> is too
 * slow (~700ms) for readers to discover; this shows in 90ms and is themed to the site.
 *
 * Document-delegated so it works for curves injected into the feed at runtime, and the card
 * is created here (not in each page's template) so the two never drift. It relies on the
 * GLOBAL `.shape-tip` rules in global.css — a runtime-created node carries no Astro scope
 * hash, so a scoped <style> would never reach it (the astro-scoped-style-runtime-dom footgun).
 * Pure DOM, no fetch. Idempotent: safe to call more than once per page.
 */

let mounted = false;

export function mountShapeTip() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;

  let tip = document.getElementById('shapeTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'shapeTip';
    tip.className = 'shape-tip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
  }
  const el = tip;
  let tipTimer = 0;

  function placeTip(curve: Element) {
    const msg = curve.getAttribute('data-shape'); if (!msg) return;
    el.textContent = msg;
    const cr = curve.getBoundingClientRect(), tr = el.getBoundingClientRect();
    let left = cr.left + cr.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, left));
    const above = cr.top - tr.height - 10, below = above < 8;
    el.classList.toggle('below', below);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(below ? cr.bottom + 10 : above)}px`;
    el.style.setProperty('--tip-arrow', `${Math.round(cr.left + cr.width / 2 - left)}px`);
    el.classList.add('on'); el.setAttribute('aria-hidden', 'false');
  }
  function hideTip() { clearTimeout(tipTimer); el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); }

  document.addEventListener('mouseover', (e) => {
    const c = (e.target as HTMLElement).closest?.('.curve'); if (!c) return;
    clearTimeout(tipTimer); tipTimer = window.setTimeout(() => placeTip(c), 90);
  });
  document.addEventListener('mouseout', (e) => {
    const c = (e.target as HTMLElement).closest?.('.curve'); if (!c) return;
    if (e.relatedTarget && c.contains(e.relatedTarget as Node)) return;  // still inside the same curve
    hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });
}
