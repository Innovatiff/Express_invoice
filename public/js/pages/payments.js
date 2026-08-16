import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  fmtDate, today, monthStart, yearStart, loadAll, orderBy, limit, onAction,
  matchesSearch, debounce, toCSV, downloadFile, toast, spinner,
} from '../app.js';
import {
  PAYMENT_METHODS,
} from '../model.js';
import {
  dataTable, sortRows, selectEl,
} from '../components.js';

const PAGE_SIZE = 400;

setPageTitle('nav_payments');
await initShell('payments.html');

const page = $('#page');
const p = params();

page.append(pageHeader('nav_payments', [
  { key: 'act_new_payment', variant: 'primary', accel: 'F8',
    onClick: () => { location.href = 'payment.html?new=1'; } },
  { key: 'act_export_csv', onClick: () => exportCsv() },
]));

const state = {
  search: p.q || '',
  method: 'all',
  from: p.from || '',
  to: p.to || '',
  sortKey: 'date',
  sortDir: 'desc',
};

let rows = [];
let filtered = [];

const searchInput = el('input', {
  type: 'search', id: 'list-search', value: state.search,
  placeholder: `${T('act_search')}`,
});
searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value; apply(); }, 160));

const methodSelect = selectEl([
  { value: 'all', labelKey: 'all' },
  ...PAYMENT_METHODS.map((m) => ({ value: m.value, labelKey: m.key })),
]);
methodSelect.addEventListener('change', () => { state.method = methodSelect.value; apply(); });

const fromInput = el('input', { type: 'date', value: state.from });
const toInput = el('input', { type: 'date', value: state.to });
fromInput.addEventListener('change', () => { state.from = fromInput.value; apply(); });
toInput.addEventListener('change', () => { state.to = toInput.value; apply(); });

const rangeSelect = selectEl([
  { value: '', labelKey: 'all' },
  { value: 'month', labelKey: 'rep_this_month' },
  { value: 'year', labelKey: 'rep_this_year' },
]);
rangeSelect.addEventListener('change', () => {
  if (rangeSelect.value === 'month') { state.from = monthStart(); state.to = today(); }
  else if (rangeSelect.value === 'year') { state.from = yearStart(); state.to = today(); }
  else { state.from = ''; state.to = ''; }
  fromInput.value = state.from;
  toInput.value = state.to;
  apply();
});

const countLabel = el('span', { class: 'result-count' });
const tableHost = el('div', {});

page.append(el('div', { class: 'card' },
  el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('act_search') }), searchInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('pay_method') }), methodSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('rep_period') }), rangeSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_from') }), fromInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_to') }), toInput),
    el('div', { class: 'spacer' }),
    countLabel,
  ),
  tableHost,
));

tableHost.append(spinner());

try {
  rows = await loadAll('payments', orderBy('date', 'desc'), limit(PAGE_SIZE));
} catch (err) {
  console.error(err);
  toast('Could not load.', 'err');
}

apply();

function methodLabel(value) {
  const m = PAYMENT_METHODS.find((x) => x.value === value);
  return m ? T(m.key) : (value || '');
}

function apply() {
  filtered = rows.filter((r) => {
    if (state.method !== 'all' && r.method !== state.method) return false;
    if (state.from && String(r.date || '') < state.from) return false;
    if (state.to && String(r.date || '') > state.to) return false;
    if (state.search) {
      const blob = [r.number, r.customerName, r.reference, r.notes,
        ...(r.allocations || []).map((a) => a.invoiceNumber)].filter(Boolean).join(' ').toLowerCase();
      if (!matchesSearch(blob, state.search)) return false;
    }
    return true;
  });
  filtered = sortRows(filtered, state.sortKey, state.sortDir, {
    date: (r) => r.date || '',
    number: (r) => r.number || '',
    customerName: (r) => r.customerName || '',
    amountCents: (r) => Number(r.amountCents) || 0,
  });
  render();
}

function render() {
  countLabel.textContent = String(filtered.length);
  tableHost.innerHTML = '';
  tableHost.append(dataTable({
    columns: [
      { key: 'number', labelKey: 'payment_number', className: 'nowrap',
        html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', html: (r) => esc(r.customerName || '—') },
      { key: 'method', labelKey: 'pay_method', className: 'nowrap',
        html: (r) => esc(methodLabel(r.method)) +
          (r.reference ? `<span class="cell-sub">${esc(r.reference)}</span>` : '') },
      { key: 'applied', labelKey: 'pay_applied_to', sortable: false, className: 'cell-muted',
        html: (r) => (r.allocations || []).length
          ? esc((r.allocations || []).map((a) => a.invoiceNumber).filter(Boolean).join(', '))
          : `<span class="pill pill-credit">${L('st_credit')}</span>` },
      { key: 'amountCents', labelKey: 'amount', className: 'num',
        html: (r) => `<strong>${esc(money(r.amountCents))}</strong>`,
        footer: (list) => esc(money(list.reduce((s, r) => s + (Number(r.amountCents) || 0), 0))) },
    ],
    rows: filtered,
    sort: { key: state.sortKey, dir: state.sortDir },
    onSort: (key) => {
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = key === 'date' ? 'desc' : 'asc'; }
      apply();
    },
    onRowClick: (r) => { location.href = `payment.html?id=${encodeURIComponent(r.id)}`; },
    emptyKey: rows.length ? 'msg_no_results' : 'msg_empty_list',
  }));

  if (rows.length >= PAGE_SIZE) {
    tableHost.append(el('div', { class: 'card-foot text-small text-muted', html:
      `Showing the ${PAGE_SIZE} most recent payments.` }));
  }
}

function exportCsv() {
  const header = [
    `${T('payment_number')}`,
    `${T('date')}`,
    `${T('customer')}`,
    `${T('pay_method')}`,
    `${T('reference')}`,
    `${T('pay_applied_to')}`,
    `${T('amount')}`,
  ];
  const body = filtered.map((r) => [
    r.number, r.date, r.customerName, methodLabel(r.method), r.reference,
    (r.allocations || []).map((a) => a.invoiceNumber).filter(Boolean).join(' '),
    (Number(r.amountCents) || 0) / 100,
  ]);
  downloadFile(`pagos-payments-${today()}.csv`, '﻿' + toCSV([header, ...body]));
}

onAction('new', () => { location.href = 'payment.html?new=1'; });
