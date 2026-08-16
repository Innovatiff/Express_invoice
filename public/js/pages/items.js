import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, money, fmtQty,
  loadAll, orderBy, onAction, matchesSearch, debounce, toCSV, downloadFile,
  toast, spinner, today,
} from '../app.js';
import {
  dataTable, sortRows, selectEl,
} from '../components.js';

setPageTitle('nav_items');
await initShell('items.html');

const page = $('#page');

page.append(pageHeader('nav_items', [
  { key: 'act_new_item', variant: 'primary', onClick: () => { location.href = 'item.html?new=1'; } },
  { key: 'act_export_csv', onClick: () => exportCsv() },
]));

const state = { search: '', category: 'all', showInactive: false, sortKey: 'code', sortDir: 'asc' };
let items = [];
let filtered = [];

const searchInput = el('input', {
  type: 'search', id: 'list-search',
  placeholder: `${T('act_search')}`,
});
searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value; apply(); }, 160));

const categorySelect = selectEl([{ value: 'all', labelKey: 'all' }]);
categorySelect.addEventListener('change', () => { state.category = categorySelect.value; apply(); });

const inactiveBox = el('input', { type: 'checkbox' });
inactiveBox.addEventListener('change', () => { state.showInactive = inactiveBox.checked; apply(); });

const countLabel = el('span', { class: 'result-count' });

page.append(el('div', { class: 'card' },
  el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('act_search') }), searchInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('item_category') }), categorySelect),
    el('label', { class: 'check' }, inactiveBox,
      el('span', { html: 'Show inactive' })),
    el('div', { class: 'spacer' }),
    countLabel,
  ),
  el('div', { id: 'items-table' }),
));

const tableHost = $('#items-table');
tableHost.append(spinner());

try {
  items = await loadAll('items', orderBy('code'));
} catch (err) {
  console.error(err);
  toast('Could not load.', 'err');
}

// Fill the category filter from what is actually on file.
const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
for (const c of categories) categorySelect.append(el('option', { value: c }, c));

apply();

function apply() {
  filtered = items.filter((i) => {
    if (!state.showInactive && i.active === false) return false;
    if (state.category !== 'all' && (i.category || '') !== state.category) return false;
    if (state.search && !matchesSearch(i.searchBlob || blob(i), state.search)) return false;
    return true;
  });
  filtered = sortRows(filtered, state.sortKey, state.sortDir, {
    code: (i) => i.code || '',
    description: (i) => i.description || '',
    priceCents: (i) => Number(i.priceCents) || 0,
    costCents: (i) => Number(i.costCents) || 0,
    qtyInStock: (i) => Number(i.qtyInStock) || 0,
    category: (i) => i.category || '',
  });
  render();
}

function blob(i) {
  return [i.code, i.description, i.category].filter(Boolean).join(' ').toLowerCase();
}

function margin(i) {
  const price = Number(i.priceCents) || 0;
  const cost = Number(i.costCents) || 0;
  if (!price || !cost) return '';
  return `${Math.round(((price - cost) / price) * 100)}%`;
}

function render() {
  countLabel.textContent = String(filtered.length);
  tableHost.innerHTML = '';
  tableHost.append(dataTable({
    columns: [
      { key: 'code', labelKey: 'item_code', className: 'nowrap',
        html: (i) => `<strong class="input-mono">${esc(i.code || '—')}</strong>` +
          (i.active === false ? ' <span class="pill pill-void">Inactivo / Inactive</span>' : '') },
      { key: 'description', labelKey: 'item_description',
        html: (i) => esc(String(i.description || '').split('\n')[0]) },
      { key: 'category', labelKey: 'item_category', className: 'cell-muted nowrap',
        html: (i) => esc(i.category || '') },
      { key: 'costCents', labelKey: 'item_cost', className: 'num cell-muted',
        html: (i) => esc(i.costCents ? money(i.costCents) : '') },
      { key: 'priceCents', labelKey: 'item_price', className: 'num',
        html: (i) => `<strong>${esc(money(i.priceCents))}</strong>` },
      { key: 'margin', labelKey: 'item_margin', className: 'num cell-muted', sortable: false,
        html: (i) => esc(margin(i)) },
      { key: 'qtyInStock', labelKey: 'item_qty_stock', className: 'num',
        html: (i) => (i.trackStock
          ? `<span class="${(Number(i.qtyInStock) || 0) <= 0 ? 'text-red' : ''}">${esc(fmtQty(i.qtyInStock))}</span>`
          : '<span class="cell-muted">—</span>') },
    ],
    rows: filtered,
    sort: { key: state.sortKey, dir: state.sortDir },
    onSort: (key) => {
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      apply();
    },
    onRowClick: (i) => { location.href = `item.html?id=${encodeURIComponent(i.id)}`; },
    emptyKey: items.length ? 'msg_no_results' : 'msg_empty_list',
  }));
}

function exportCsv() {
  const header = [
    `${T('item_code')}`,
    `${T('item_description')}`,
    `${T('item_category')}`,
    `${T('item_unit')}`,
    `${T('item_cost')}`,
    `${T('item_price')}`,
    `${T('item_taxable')}`,
    `${T('item_qty_stock')}`,
  ];
  const body = filtered.map((i) => [
    i.code, i.description, i.category, i.unit,
    (Number(i.costCents) || 0) / 100,
    (Number(i.priceCents) || 0) / 100,
    i.taxable === false ? 'No' : 'Yes',
    i.trackStock ? (Number(i.qtyInStock) || 0) : '',
  ]);
  downloadFile(`articulos-items-${today()}.csv`, '﻿' + toCSV([header, ...body]));
}

onAction('new', () => { location.href = 'item.html?new=1'; });
