import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, money, loadAll,
  orderBy, where, limit, onAction, matchesSearch, debounce, toCSV,
  downloadFile, toast, spinner, today,
} from '../app.js';

import {
  dataTable, sortRows,
} from '../components.js';

setPageTitle('nav_customers');
await initShell('customers.html');

const page = $('#page');

page.append(pageHeader('nav_customers', [
  { key: 'act_new_customer', variant: 'primary', onClick: () => { location.href = 'customer.html?new=1'; } },
  { key: 'act_export_csv', onClick: () => exportCsv() },
]));

const state = { search: '', showInactive: false, sortKey: 'name', sortDir: 'asc' };
let customers = [];
let balances = new Map();
let filtered = [];

const searchInput = el('input', {
  type: 'search', id: 'list-search',
  placeholder: `${T('act_search')}`,
});
searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value; apply(); }, 160));

const inactiveBox = el('input', { type: 'checkbox' });
inactiveBox.addEventListener('change', () => { state.showInactive = inactiveBox.checked; apply(); });

const countLabel = el('span', { class: 'result-count' });

const filters = el('div', { class: 'filters' },
  el('div', { class: 'field' },
    el('label', { class: 'field-label', html: L('act_search') }), searchInput),
  el('label', { class: 'check' }, inactiveBox,
    el('span', { html: 'Show inactive' })),
  el('div', { class: 'spacer' }),
  countLabel,
);

const tableHost = el('div', {});
page.append(el('div', { class: 'card' }, filters, tableHost));
tableHost.append(spinner());

try {
  customers = await loadAll('customers', orderBy('name'));

  // Open balance per customer, taken from invoices that still owe something.
  const openInvoices = await loadAll('invoices', where('balanceCents', '>', 0), limit(2000));
  for (const inv of openInvoices) {
    if (inv.voided || inv.status === 'draft' || !inv.customerId) continue;
    balances.set(inv.customerId, (balances.get(inv.customerId) || 0) + (Number(inv.balanceCents) || 0));
  }
} catch (err) {
  console.error(err);
  toast('Could not load.', 'err');
}

apply();

function apply() {
  filtered = customers.filter((c) => {
    if (!state.showInactive && c.active === false) return false;
    if (state.search && !matchesSearch(c.searchBlob || blob(c), state.search)) return false;
    return true;
  });
  filtered = sortRows(filtered, state.sortKey, state.sortDir, {
    name: (c) => c.name || c.company || '',
    company: (c) => c.company || '',
    phone: (c) => c.phone || c.mobile || '',
    city: (c) => c.city || '',
    balance: (c) => balances.get(c.id) || 0,
  });
  render();
}

function blob(c) {
  return [c.name, c.company, c.account, c.email, c.phone, c.mobile, c.city]
    .filter(Boolean).join(' ').toLowerCase();
}

function render() {
  countLabel.textContent = String(filtered.length);
  tableHost.innerHTML = '';
  tableHost.append(dataTable({
    columns: [
      { key: 'name', labelKey: 'cust_name',
        html: (c) => `<strong>${esc(c.name || c.company || '—')}</strong>` +
          (c.company && c.company !== c.name ? `<span class="cell-sub">${esc(c.company)}</span>` : '') +
          (c.active === false ? ' <span class="pill pill-void">Inactivo / Inactive</span>' : '') },
      { key: 'phone', labelKey: 'cust_phone', className: 'nowrap',
        html: (c) => esc(c.phone || c.mobile || '') +
          (c.email ? `<span class="cell-sub">${esc(c.email)}</span>` : '') },
      { key: 'city', labelKey: 'cust_city', className: 'cell-muted',
        html: (c) => esc([c.city, c.state].filter(Boolean).join(', ')) },
      { key: 'account', labelKey: 'cust_account', className: 'cell-muted nowrap',
        html: (c) => esc(c.account || '') },
      { key: 'balance', labelKey: 'cust_open_balance', className: 'num',
        html: (c) => {
          const b = balances.get(c.id) || 0;
          return b > 0 ? `<strong>${esc(money(b))}</strong>` : `<span class="cell-muted">${esc(money(0))}</span>`;
        },
        footer: (list) => esc(money(list.reduce((s, c) => s + (balances.get(c.id) || 0), 0))) },
    ],
    rows: filtered,
    sort: { key: state.sortKey, dir: state.sortDir },
    onSort: (key) => {
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      apply();
    },
    onRowClick: (c) => { location.href = `customer.html?id=${encodeURIComponent(c.id)}`; },
    emptyKey: customers.length ? 'msg_no_results' : 'msg_empty_list',
  }));
}

function exportCsv() {
  const header = [
    `${T('cust_name')}`,
    `${T('cust_company')}`,
    `${T('cust_account')}`,
    `${T('cust_address')}`,
    `${T('cust_city')}`,
    `${T('cust_state')}`,
    `${T('cust_zip')}`,
    `${T('cust_phone')}`,
    `${T('cust_mobile')}`,
    `${T('cust_email')}`,
    `${T('cust_open_balance')}`,
  ];
  const body = filtered.map((c) => [
    c.name, c.company, c.account, c.address, c.city, c.state, c.zip,
    c.phone, c.mobile, c.email, (balances.get(c.id) || 0) / 100,
  ]);
  downloadFile(`clientes-customers-${today()}.csv`, '﻿' + toCSV([header, ...body]));
}

onAction('new', () => { location.href = 'customer.html?new=1'; });
