// ---------------------------------------------------------------------------
// The invoice / quote / order list.
//
// Filters across the top, dense table beneath, running totals in the footer —
// the same shape as the desktop list views, so the columns land where the
// owner's eye already expects them.
// ---------------------------------------------------------------------------

import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  fmtDate, today, monthStart, yearStart, addDays, loadAll, orderBy,
  onAction, toast, matchesSearch, debounce, toCSV, downloadFile, spinner,
} from './app.js';
import {
  DOC_TYPES, displayStatus, statusKey, QUOTE_STATUSES, ORDER_STATUSES,
} from './model.js';
import {
  statusPill, dataTable, sortRows, field, selectEl,
} from './components.js';

// Every document is loaded — ten years of invoices is one list you scroll,
// the way the desktop program showed it, not a "most recent 400" window.
// Rendering is what gets chunked: CHUNK rows go into the table at a time and
// more follow as you reach the bottom, so three thousand rows do not have to
// be built before the first one is visible.
const CHUNK = 150;

/**
 * The from/to dates a named period covers, as YYYY-MM-DD strings.
 *
 * Worked out on the string, never on a Date the browser might shift into
 * yesterday: an invoice dated the 1st must not fall out of "This Month"
 * because the machine is an hour behind UTC.
 */
function periodRange(key) {
  const now = today();
  const [y, m] = now.split('-').map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();

  switch (key) {
    case 'today': return { from: now, to: now };
    case 'week': {
      // Monday to today, the way a shop counts its week.
      const dow = (new Date(`${now}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: addDays(now, -dow), to: now };
    }
    case 'month': return { from: monthStart(), to: now };
    case 'lastmonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case 'd30': return { from: addDays(now, -29), to: now };
    case 'd90': return { from: addDays(now, -89), to: now };
    case 'quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: iso(y, qm, 1), to: now };
    }
    case 'year': return { from: yearStart(), to: now };
    case 'lastyear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: '', to: '' };
  }
}

export async function mountDocList(type) {
  const cfg = DOC_TYPES[type];
  setPageTitle(cfg.navKey);
  await initShell(cfg.listPage);

  const page = $('#page');
  const p = params();

  page.append(pageHeader(cfg.navKey, [
    { key: type === 'invoice' ? 'act_new_invoice' : type === 'quote' ? 'act_new_quote' : 'act_new_order',
      variant: 'primary',
      accel: type === 'invoice' ? 'F2' : type === 'quote' ? 'F3' : 'F4',
      onClick: () => { location.href = `${cfg.editPage}?new=1`; } },
    { key: 'act_export_csv', onClick: () => exportCsv() },
  ]));

  const state = {
    search: p.q || '',
    status: p.status || 'all',
    from: p.from || '',
    to: p.to || '',
    customerId: p.customer || '',
    sortKey: 'date',
    sortDir: 'desc',
  };

  let rows = [];
  let filtered = [];
  let shown = CHUNK;   // how many of `filtered` are actually in the table

  // ---- Filter bar -----------------------------------------------------------

  const searchInput = el('input', {
    type: 'search', id: 'list-search', value: state.search,
    placeholder: `${T('act_search')}`,
  });
  searchInput.addEventListener('input', debounce(() => {
    state.search = searchInput.value;
    applyFilters();
  }, 160));

  const statusOptions = [{ value: 'all', labelKey: 'all' }];
  if (type === 'invoice') {
    for (const s of ['draft', 'unpaid', 'partial', 'paid', 'overdue', 'void']) {
      statusOptions.push({ value: s, labelKey: statusKey(s) });
    }
  } else {
    const list = type === 'quote' ? QUOTE_STATUSES : ORDER_STATUSES;
    for (const s of list) statusOptions.push({ value: s, labelKey: statusKey(s) });
  }
  const statusSelect = selectEl(
    statusOptions.map((o) => ({ ...o, selected: o.value === state.status })),
  );
  statusSelect.addEventListener('change', () => { state.status = statusSelect.value; applyFilters(); });

  const fromInput = el('input', { type: 'date', value: state.from });
  const toInput = el('input', { type: 'date', value: state.to });
  fromInput.addEventListener('change', () => { state.from = fromInput.value; applyFilters(); });
  toInput.addEventListener('change', () => { state.to = toInput.value; applyFilters(); });

  const rangeSelect = selectEl([
    { value: '', labelKey: 'all' },
    { value: 'today', labelKey: 'rep_today' },
    { value: 'week', labelKey: 'rep_this_week' },
    { value: 'month', labelKey: 'rep_this_month' },
    { value: 'lastmonth', labelKey: 'rep_last_month' },
    { value: 'd30', labelKey: 'rep_last_30' },
    { value: 'd90', labelKey: 'rep_last_90' },
    { value: 'quarter', labelKey: 'rep_this_quarter' },
    { value: 'year', labelKey: 'rep_this_year' },
    { value: 'lastyear', labelKey: 'rep_last_year' },
  ]);
  rangeSelect.addEventListener('change', () => {
    const range = periodRange(rangeSelect.value);
    state.from = range.from;
    state.to = range.to;
    fromInput.value = state.from;
    toInput.value = state.to;
    applyFilters();
  });

  const countLabel = el('span', { class: 'result-count' });

  const filters = el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('act_search') }), searchInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('status') }), statusSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('rep_period') }), rangeSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_from') }), fromInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_to') }), toInput),
    el('div', { class: 'spacer' }),
    countLabel,
    el('button', {
      class: 'btn btn-default btn-sm', type: 'button', html: L('act_clear'),
      onclick: () => {
        state.search = ''; state.status = 'all'; state.from = ''; state.to = ''; state.customerId = '';
        searchInput.value = ''; statusSelect.value = 'all';
        fromInput.value = ''; toInput.value = ''; rangeSelect.value = '';
        applyFilters();
      },
    }),
  );

  const tableHost = el('div', {});
  page.append(el('div', { class: 'card' }, filters, tableHost));
  tableHost.append(spinner());

  // ---- Load -----------------------------------------------------------------

  try {
    rows = await loadAll(cfg.collection, orderBy('date', 'desc'));
  } catch (err) {
    console.error('Could not load documents', err);
    tableHost.innerHTML = '';
    tableHost.append(el('div', { class: 'empty' },
      el('p', { html: 'Could not load the list.' }),
      el('p', { class: 'text-small text-muted', text: err.message || '' }),
    ));
    return;
  }

  applyFilters();

  // ---- Filtering + rendering ------------------------------------------------

  function applyFilters() {
    const asOf = today();
    filtered = rows.filter((r) => {
      if (state.customerId && r.customerId !== state.customerId) return false;
      if (state.from && String(r.date || '') < state.from) return false;
      if (state.to && String(r.date || '') > state.to) return false;
      if (state.status !== 'all' && displayStatus(r, asOf) !== state.status) return false;
      if (state.search && !matchesSearch(r.searchBlob || buildBlob(r), state.search)) return false;
      return true;
    });

    filtered = sortRows(filtered, state.sortKey, state.sortDir, {
      date: (r) => r.date || '',
      number: (r) => r.number || '',
      customerName: (r) => r.customerName || '',
      totalCents: (r) => Number(r.totalCents) || 0,
      balanceCents: (r) => Number(r.balanceCents) || 0,
      status: (r) => displayStatus(r, asOf),
    });

    // Any change of filter or sort starts the list again from the top.
    shown = CHUNK;
    render();
  }

  function buildBlob(r) {
    return [r.number, r.customerName, r.poNumber, r.salesPerson].filter(Boolean).join(' ').toLowerCase();
  }

  function render() {
    const asOf = today();
    countLabel.textContent = filtered.length === rows.length
      ? String(filtered.length)
      : `${filtered.length} ${T('of')} ${rows.length}`;

    const columns = [
      { key: 'number', labelKey: cfg.numberKey, className: 'nowrap',
        html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer',
        html: (r) => `${esc(r.customerName || '—')}${r.poNumber ? `<span class="cell-sub">PO ${esc(r.poNumber)}</span>` : ''}` },
      { key: 'totalCents', labelKey: 'total', className: 'num', html: (r) => esc(money(r.totalCents)),
        footer: true, footerSum: (s, r) => s + (Number(r.totalCents) || 0) },
    ];

    if (cfg.hasPayments) {
      columns.push(
        { key: 'paidCents', labelKey: 'amount_paid', className: 'num', html: (r) => esc(money(r.paidCents)),
          footer: true, footerSum: (s, r) => s + (Number(r.paidCents) || 0) },
        { key: 'balanceCents', labelKey: 'balance_due', className: 'num',
          html: (r) => `<strong>${esc(money(r.balanceCents))}</strong>`,
          footer: true, footerSum: (s, r) => s + (Number(r.balanceCents) || 0) },
      );
    }
    if (cfg.hasDueDate) {
      columns.push({ key: 'dueDate', labelKey: 'due_date', className: 'nowrap cell-muted',
        html: (r) => esc(fmtDate(r.dueDate)) });
    }
    columns.push({ key: 'status', labelKey: 'status', className: 'nowrap',
      html: (r) => statusPill(r, asOf) });

    // Footer totals are over everything that matched, not over the rows drawn
    // so far — a running total that grows as you scroll would be a lie.
    const totalsOf = (fn) => () => esc(money(filtered.reduce(fn, 0)));
    for (const column of columns) {
      if (column.footer) column.footer = totalsOf(column.footerSum);
    }

    tableHost.innerHTML = '';
    tableHost.append(dataTable({
      columns,
      rows: filtered.slice(0, shown),
      sort: { key: state.sortKey, dir: state.sortDir },
      onSort: (key) => {
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = key; state.sortDir = key === 'date' ? 'desc' : 'asc'; }
        applyFilters();
      },
      onRowClick: (r) => { location.href = `${cfg.editPage}?id=${encodeURIComponent(r.id)}`; },
      rowClass: (r) => (r.voided ? 'is-void' : ''),
      emptyKey: rows.length ? 'msg_no_results' : 'msg_empty_list',
    }));

    // More rows as you reach the bottom. The sentinel is watched rather than
    // polled on scroll, so a three-thousand-row list still scrolls smoothly.
    if (shown < filtered.length) {
      const sentinel = el('div', { class: 'list-more text-small text-muted', html:
        `${shown} ${T('of')} ${filtered.length} — <span class="spin-dot"></span> loading more…` });
      tableHost.append(sentinel);
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        shown = Math.min(shown + CHUNK, filtered.length);
        render();
      }, { rootMargin: '400px' });
      observer.observe(sentinel);
    } else if (filtered.length > CHUNK) {
      tableHost.append(el('div', { class: 'card-foot text-small text-muted', html:
        `All ${filtered.length} shown.` }));
    }
  }

  function exportCsv() {
    const asOf = today();
    const header = [
      T(cfg.numberKey), T('date'), T('customer'), T('po_number'),
      T('subtotal'), T('tax'), T('total'), T('amount_paid'),
      T('balance_due'), T('status'),
    ];
    const body = filtered.map((r) => [
      r.number, r.date, r.customerName, r.poNumber,
      (Number(r.subtotalCents) || 0) / 100,
      (Number(r.taxCents) || 0) / 100,
      (Number(r.totalCents) || 0) / 100,
      (Number(r.paidCents) || 0) / 100,
      (Number(r.balanceCents) || 0) / 100,
      T(statusKey(displayStatus(r, asOf))),
    ]);
    downloadFile(`${type}s-${today()}.csv`, '﻿' + toCSV([header, ...body]));
    toast(`${filtered.length} ${T('imp_rows_found')}`, 'ok');
  }

  onAction('new', () => { location.href = `${cfg.editPage}?new=1`; });
}
