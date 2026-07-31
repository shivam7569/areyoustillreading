/**
 * mountSeriesPicker — a small on-brand combobox for choosing (or naming) a series.
 * Reused by the Write publish sheet and the Posts "Add to series" modal so both
 * behave identically: a trigger styled like the schedule pickers (.spick/.spop),
 * opening a searchable list of the site's existing series plus a "Create …" row
 * for a brand-new name. "No series" clears it.
 *
 * It writes nothing itself — the caller wires `onChange` (e.g. into a hidden input
 * the publish/save handler already reads), and drives the display with setValue().
 */
export type SeriesPicker = {
  getValue: () => string;
  setValue: (name: string) => void;
  setNames: (names: string[]) => void;
  refresh: () => Promise<void>;
};

type Opts = {
  initial?: string;
  loadNames: () => Promise<string[]>;   // the site's existing series titles
  onChange: (name: string) => void;      // '' = No series
  emptyLabel?: string;                    // default "No series"
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]));

export function mountSeriesPicker(host: HTMLElement, opts: Opts): SeriesPicker {
  const emptyLabel = opts.emptyLabel || 'No series';
  let value = (opts.initial || '').trim();
  let names: string[] = [];

  host.innerHTML = `<div class="spwrap sepick">
    <button type="button" class="spick" aria-haspopup="listbox" aria-expanded="false">
      <span class="spick-v"></span>
      <svg class="spick-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="spop" role="listbox" hidden></div>
  </div>`;
  const wrap = host.querySelector('.spwrap') as HTMLElement;
  const trigger = host.querySelector('.spick') as HTMLElement;
  const label = host.querySelector('.spick-v') as HTMLElement;
  const panel = host.querySelector('.spop') as HTMLElement;

  const renderLabel = () => {
    label.textContent = value || emptyLabel;
    label.classList.toggle('is-empty', !value);
  };

  let open = false;
  const onDoc = (e: Event) => { if (!wrap.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  function close() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  }
  const pick = (v: string) => { value = (v || '').trim(); renderLabel(); opts.onChange(value); close(); };

  function buildPanel() {
    panel.innerHTML = `<div class="tz-s"><input type="text" placeholder="Search or name a series…" data-focus autocomplete="off"></div><div class="tz-l"></div>`;
    const input = panel.querySelector('input') as HTMLInputElement;
    const list = panel.querySelector('.tz-l') as HTMLElement;
    const renderList = () => {
      const q = input.value.trim();
      const ql = q.toLowerCase();
      const filtered = names.filter((n) => !ql || n.toLowerCase().includes(ql));
      const exact = names.some((n) => n.toLowerCase() === ql);
      let rows = `<button type="button" class="tz-i${value ? '' : ' sel'}" data-v=""><span>${esc(emptyLabel)}</span></button>`;
      rows += filtered.map((n) => `<button type="button" class="tz-i${n === value ? ' sel' : ''}" data-v="${esc(n)}"><span>${esc(n)}</span></button>`).join('');
      if (q && !exact) rows += `<button type="button" class="tz-i se-new" data-new="${esc(q)}"><span>＋ Create “${esc(q)}”</span></button>`;
      list.innerHTML = rows;
      list.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); pick((b as HTMLElement).dataset.v || ''); }));
      list.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); pick((b as HTMLElement).dataset.new || ''); }));
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (v) pick(v); }
    });
    input.addEventListener('input', renderList);
    renderList();
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open) { close(); return; }
    open = true;
    buildPanel();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (panel.querySelector('[data-focus]') as HTMLElement | null)?.focus();
    setTimeout(() => {
      document.addEventListener('click', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  });

  renderLabel();

  return {
    getValue: () => value,
    setValue: (v: string) => { value = (v || '').trim(); renderLabel(); },
    setNames: (list: string[]) => { names = Array.isArray(list) ? list.slice() : []; },
    async refresh() { try { names = await opts.loadNames(); } catch { names = []; } },
  };
}
