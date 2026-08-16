// ---------------------------------------------------------------------------
// Reusable UI pieces shared by several screens.
// ---------------------------------------------------------------------------

import {
  el, esc, L, T, money, fmtDate, matchesSearch, debounce,
} from './app.js';
import {
  displayStatus, statusKey,
} from './model.js';

// ===========================================================================
// Status pill
// ===========================================================================

export function statusPill(docOrStatus, asOf) {
  const status = typeof docOrStatus === 'string' ? docOrStatus : displayStatus(docOrStatus, asOf);
  return `<span class="pill pill-${esc(status)}">${L(statusKey(status))}</span>`;
}

// ===========================================================================
// Autocomplete / combobox
//
// A text input that filters an in-memory list, keyboard driven: arrows to move,
// Enter to take the highlighted row, Escape to close. Typing a value that is
// not on the list is allowed — the desktop app let you do that too.
// ===========================================================================

export function autocomplete(input, {
  source,               // () => array
  filter,               // (row, term) => boolean
  render,               // (row) => html for the dropdown line
  valueOf,              // (row) => string put into the input
  onPick,               // (row) => void
  onFreeText,           // (text) => void, fired on blur when nothing was picked
  minChars = 0,
  emptyAction,          // { label, onClick }
} = {}) {
  const wrap = el('div', { class: 'ac' });
  input.replaceWith(wrap);
  wrap.append(input);

  const list = el('div', { class: 'ac-list', role: 'listbox' });
  wrap.append(list);

  let rows = [];
  let activeIndex = -1;
  let picked = false;

  const close = () => {
    list.classList.remove('is-open');
    activeIndex = -1;
  };

  const open = () => {
    if (list.children.length) list.classList.add('is-open');
  };

  const paint = () => {
    const term = input.value.trim();
    const all = source() || [];
    rows = term.length >= minChars
      ? all.filter((r) => (filter ? filter(r, term) : matchesSearch(r._blob || '', term))).slice(0, 40)
      : all.slice(0, 40);

    list.innerHTML = '';
    if (!rows.length) {
      const empty = el('div', { class: 'ac-empty', html: L('msg_no_results') });
      list.append(empty);
      if (emptyAction) {
        list.append(el('div', {
          class: 'ac-item',
          html: `<strong>+ ${esc(emptyAction.label)}</strong>`,
          onmousedown: (e) => { e.preventDefault(); emptyAction.onClick(input.value.trim()); close(); },
        }));
      }
      open();
      return;
    }
    rows.forEach((row, i) => {
      list.append(el('div', {
        class: 'ac-item' + (i === activeIndex ? ' is-active' : ''),
        role: 'option',
        html: render ? render(row) : esc(String(row)),
        onmousedown: (e) => { e.preventDefault(); choose(i); },
      }));
    });
    open();
  };

  const choose = (i) => {
    const row = rows[i];
    if (!row) return;
    picked = true;
    input.value = valueOf ? valueOf(row) : String(row);
    close();
    onPick?.(row);
  };

  const highlight = (delta) => {
    if (!rows.length) return;
    activeIndex = (activeIndex + delta + rows.length) % rows.length;
    Array.from(list.querySelectorAll('.ac-item')).forEach((n, i) => {
      n.classList.toggle('is-active', i === activeIndex);
    });
    list.querySelector('.ac-item.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.addEventListener('input', debounce(() => { picked = false; activeIndex = -1; paint(); }, 90));
  input.addEventListener('focus', () => { activeIndex = -1; paint(); });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      if (!picked && onFreeText) onFreeText(input.value.trim());
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!list.classList.contains('is-open')) paint(); highlight(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
    else if (e.key === 'Enter') {
      if (list.classList.contains('is-open') && activeIndex >= 0) { e.preventDefault(); choose(activeIndex); }
      else close();
    } else if (e.key === 'Escape') {
      if (list.classList.contains('is-open')) { e.stopPropagation(); close(); }
    } else if (e.key === 'Tab') {
      if (list.classList.contains('is-open') && activeIndex >= 0) choose(activeIndex);
      else close();
    }
  });

  return {
    wrap,
    input,
    refresh: paint,
    setValue(v) { input.value = v ?? ''; picked = true; },
  };
}

/** Customer picker wired to the cached customer list. */
export function customerAutocomplete(input, customers, onPick, onNew) {
  return autocomplete(input, {
    source: () => customers(),
    render: (c) => {
      const sub = [c.company !== c.name ? c.company : '', c.phone || c.mobile, c.city]
        .filter(Boolean).join(' · ');
      return `${esc(c.name || c.company)}${sub ? `<span class="ac-sub">${esc(sub)}</span>` : ''}`;
    },
    valueOf: (c) => c.name || c.company || '',
    onPick,
    emptyAction: onNew ? { label: T('act_new_customer'), onClick: onNew } : null,
  });
}

/** Item picker: matches on code or description. */
export function itemAutocomplete(input, items, onPick) {
  return autocomplete(input, {
    source: () => items(),
    render: (i) => `<strong>${esc(i.code || '')}</strong> ${esc(truncate(i.description, 60))}` +
      `<span class="ac-sub">${money(i.priceCents)}${i.category ? ' · ' + esc(i.category) : ''}</span>`,
    valueOf: (i) => i.code || '',
    onPick,
  });
}

function truncate(s, n) {
  const str = String(s || '').replace(/\s+/g, ' ');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// ===========================================================================
// Sortable data table
// ===========================================================================

/**
 * columns: [{ key, labelKey|label, className, sortable, value(row), html(row), footer(rows) }]
 */
export function dataTable({ columns, rows, onRowClick, rowClass, emptyKey = 'msg_no_results', sort, onSort }) {
  const table = el('table', { class: 'data' });

  const thead = el('thead');
  const tr = el('tr');
  for (const c of columns) {
    const sorted = sort && sort.key === c.key ? (sort.dir === 'asc' ? ' sort-asc' : ' sort-desc') : '';
    const th = el('th', {
      class: (c.className || '') + (c.sortable === false ? '' : ' sortable') + sorted,
      html: c.labelKey ? L(c.labelKey) : esc(c.label || ''),
    });
    if (c.sortable !== false && onSort) {
      th.addEventListener('click', () => onSort(c.key));
    }
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);

  const tbody = el('tbody');
  if (!rows.length) {
    tbody.append(el('tr', {},
      el('td', { colspan: columns.length },
        el('div', { class: 'empty', html: `<p>${L(emptyKey)}</p>` }),
      ),
    ));
  } else {
    for (const row of rows) {
      const trow = el('tr', {
        class: (onRowClick ? 'is-clickable ' : '') + (rowClass ? rowClass(row) : ''),
      });
      if (onRowClick) {
        trow.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select')) return;
          onRowClick(row);
        });
      }
      for (const c of columns) {
        trow.append(el('td', {
          class: c.className || '',
          html: c.html ? c.html(row) : esc(c.value ? c.value(row) : ''),
        }));
      }
      tbody.append(trow);
    }
  }
  table.append(tbody);

  if (rows.length && columns.some((c) => c.footer)) {
    const tfoot = el('tfoot');
    const frow = el('tr');
    for (const c of columns) {
      frow.append(el('td', { class: c.className || '', html: c.footer ? c.footer(rows) : '' }));
    }
    tfoot.append(frow);
    table.append(tfoot);
  }

  return el('div', { class: 'table-wrap' }, table);
}

/** Generic client-side sort comparator factory. */
export function sortRows(rows, key, dir, accessors = {}) {
  const get = accessors[key] || ((r) => r[key]);
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av ?? '').localeCompare(String(bv ?? ''), 'es', { numeric: true }) * sign;
  });
}

// ===========================================================================
// Small building blocks
// ===========================================================================

export function field(labelKey, control, hint) {
  return el('div', { class: 'field' },
    el('label', { class: 'field-label', html: L(labelKey) }),
    control,
    hint ? el('p', { class: 'field-hint', html: hint }) : null,
  );
}

export function textInput(attrs = {}) {
  return el('input', { type: 'text', ...attrs });
}

export function dateInput(attrs = {}) {
  return el('input', { type: 'date', ...attrs });
}

export function moneyInputEl(attrs = {}) {
  return el('input', { type: 'text', class: 'input-money', inputmode: 'decimal', ...attrs });
}

export function checkbox(labelKey, attrs = {}) {
  return el('label', { class: 'check' },
    el('input', { type: 'checkbox', ...attrs }),
    el('span', { html: L(labelKey) }),
  );
}

export function selectEl(options, attrs = {}) {
  const s = el('select', attrs);
  for (const o of options) {
    s.append(el('option', { value: o.value, selected: o.selected || false },
      o.labelKey ? T(o.labelKey) : o.label));
  }
  return s;
}

export function card(titleKey, bodyNode, { headExtra, flush = false, foot } = {}) {
  return el('div', { class: 'card' },
    titleKey ? el('div', { class: 'card-head' },
      el('h2', { html: L(titleKey) }),
      headExtra || null,
    ) : null,
    el('div', { class: 'card-body' + (flush ? ' card-body--flush' : '') }, bodyNode),
    foot ? el('div', { class: 'card-foot' }, foot) : null,
  );
}

export function stat(labelKey, value, { sub, tone } = {}) {
  return el('div', { class: 'stat' + (tone ? ` stat--${tone}` : '') },
    el('div', { class: 'stat-label', html: L(labelKey) }),
    el('div', { class: 'stat-value', text: value }),
    sub ? el('div', { class: 'stat-sub', html: sub }) : null,
  );
}

/** Renders a document reference as a link to its editor. */
export function docLink(doc_, page) {
  return `<a href="${page}?id=${encodeURIComponent(doc_.id)}">${esc(doc_.number || '—')}</a>`;
}

export function fmtDateCell(isoDate) {
  return `<span class="nowrap">${esc(fmtDate(isoDate))}</span>`;
}
