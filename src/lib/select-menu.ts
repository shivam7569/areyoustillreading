/*
 * src/lib/select-menu.ts — an editorial dropdown that actually looks like the site.
 * ---------------------------------------------------------------------------
 * A native <select>'s POPUP is drawn by the operating system, not the page: you can set
 * its colour scheme, but not its type, spacing, corners or selected-row treatment. So on a
 * site with this much typographic character it always reads as a foreign control.
 *
 * This enhances a real <select> into a styled listbox WITHOUT taking the select away:
 *
 *   - The <select> stays in the DOM and remains the single source of truth. We set its
 *     .value and dispatch a real 'change' event, so any page logic already listening to it
 *     (or assigning .value, e.g. a "clear the filters" reset) keeps working untouched.
 *   - It is only hidden once the enhanced UI is built, so with JS disabled or broken the
 *     reader still gets a working native control. Progressive enhancement, not replacement.
 *   - The <option> elements remain the copy source, so their data-cms anchors still receive
 *     the edge overlay's Studio edits — we mirror option text into the menu at build time.
 *
 * Accessibility follows the ARIA listbox pattern: the trigger is a button with
 * aria-haspopup/aria-expanded, the panel is role="listbox" with role="option" children and
 * roving focus. Full keyboard support (arrows, Home/End, Enter/Space, Escape, type-ahead),
 * focus returns to the trigger on close, and the select's own accessible name is reused.
 */

const KEYS_OPEN = ['Enter', ' ', 'ArrowDown', 'ArrowUp'];

export function enhanceSelect(sel: HTMLSelectElement): () => void {
  if (!sel || (sel as any)._selmenu) return () => {};
  const opts = Array.from(sel.options);
  if (!opts.length) return () => {};

  const label = sel.getAttribute('aria-label') || '';
  const wrap = document.createElement('div');
  wrap.className = 'selmenu';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'selmenu-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  if (label) btn.setAttribute('aria-label', label);
  const text = document.createElement('span');
  text.className = 'selmenu-val';
  btn.append(text);
  btn.insertAdjacentHTML('beforeend',
    '<svg class="selmenu-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');

  const list = document.createElement('ul');
  list.className = 'selmenu-list';
  list.setAttribute('role', 'listbox');
  if (label) list.setAttribute('aria-label', label);
  list.hidden = true;

  const items = opts.map((o, i) => {
    const li = document.createElement('li');
    li.className = 'selmenu-opt';
    li.setAttribute('role', 'option');
    li.tabIndex = -1;
    li.dataset.value = o.value;
    li.textContent = o.textContent || o.value; // copy comes from the <option> (overlay-patched)
    li.addEventListener('click', () => choose(i));
    return li;
  });
  list.append(...items);
  wrap.append(btn, list);
  sel.insertAdjacentElement('afterend', wrap);

  // Only now hide the native control — if anything above threw, the select is still usable.
  sel.classList.add('selmenu-native');
  sel.setAttribute('tabindex', '-1');
  sel.setAttribute('aria-hidden', 'true');

  let open = false;

  const sync = () => {
    const i = Math.max(0, sel.selectedIndex);
    text.textContent = opts[i]?.textContent || '';
    items.forEach((li, k) => {
      const on = k === i;
      li.setAttribute('aria-selected', String(on));
      li.classList.toggle('on', on);
    });
  };

  function choose(i: number) {
    if (sel.selectedIndex !== i) {
      sel.selectedIndex = i;
      // a REAL change event, so existing listeners on the select fire exactly as before
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync();
    close(true);
  }

  function openMenu() {
    if (open) return;
    open = true;
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');
    (items[Math.max(0, sel.selectedIndex)] || items[0]).focus();
    addEventListener('pointerdown', onOutside, true);
  }
  function close(refocus: boolean) {
    if (!open) return;
    open = false;
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open');
    removeEventListener('pointerdown', onOutside, true);
    if (refocus) btn.focus();
  }
  const onOutside = (e: Event) => { if (!wrap.contains(e.target as Node)) close(false); };

  btn.addEventListener('click', () => (open ? close(true) : openMenu()));
  btn.addEventListener('keydown', (e) => {
    if (KEYS_OPEN.includes(e.key)) { e.preventDefault(); openMenu(); }
  });

  let typed = '', typedAt = 0;
  list.addEventListener('keydown', (e) => {
    const cur = items.indexOf(document.activeElement as HTMLLIElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length].focus(); };
    switch (e.key) {
      case 'ArrowDown': return go(cur + 1);
      case 'ArrowUp': return go(cur - 1);
      case 'Home': return go(0);
      case 'End': return go(items.length - 1);
      case 'Escape': e.preventDefault(); return close(true);
      case 'Tab': return close(false);
      case 'Enter':
      case ' ': e.preventDefault(); return choose(cur < 0 ? sel.selectedIndex : cur);
      default: {
        if (e.key.length !== 1) return;
        const now = Date.now();
        typed = now - typedAt > 700 ? e.key : typed + e.key;
        typedAt = now;
        const hit = items.findIndex((li) => (li.textContent || '').toLowerCase().startsWith(typed.toLowerCase()));
        if (hit >= 0) go(hit);
      }
    }
  });

  // Keep the button in step when something else assigns select.value (e.g. the reset link).
  sel.addEventListener('change', sync);
  sync();
  (sel as any)._selmenu = true;

  return () => {
    close(false);
    sel.removeEventListener('change', sync);
    wrap.remove();
    sel.classList.remove('selmenu-native');
    sel.removeAttribute('tabindex');
    sel.removeAttribute('aria-hidden');
    delete (sel as any)._selmenu;
  };
}
