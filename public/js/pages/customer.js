import {
  $, el, esc, L, initShell, pageHeader, setPageTitle, params, money,
  moneyInput, parseMoney, parseRate, fmtDate, loadOne, loadAll, saveRecord,
  removeRecord, orderBy, where, limit, onAction, toast, toastKey,
  confirmDialog, trackDirty, spinner,
  byDateDesc,
} from '../app.js';
import {
  blankCustomer, customerSearchBlob,
} from '../model.js';
import {
  field, card, dataTable, statusPill,
} from '../components.js';
import {
  invalidate as invalidateStore,
} from '../store.js';

setPageTitle('customer');
await initShell('customers.html');

const page = $('#page');
const p = params();
const isNew = !p.id;

let record = blankCustomer();
if (!isNew) {
  const loaded = await loadOne('customers', p.id);
  if (!loaded) {
    page.append(el('div', { class: 'empty', html: `<p>${L('msg_not_found')}</p>` }));
    throw new Error('customer not found');
  }
  record = { ...blankCustomer(), ...loaded, id: p.id };
}

let dirty = false;
const markDirty = () => { dirty = true; };
trackDirty(() => dirty);

const header = pageHeader('customer', [
  { key: 'act_save', variant: 'primary', accel: 'Ctrl+S', onClick: () => save({ stay: true }) },
  { key: 'act_new_invoice', onClick: () => newDoc('invoice') },
  { key: 'act_new_quote', onClick: () => newDoc('quote') },
  { key: 'doc_statement', onClick: () => goStatement() },
  !isNew ? { key: 'act_delete', variant: 'danger', onClick: () => destroy() } : null,
]);
page.append(header);
refreshTitle();

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

const inputs = {};

function bind(name, node, transform) {
  node.value = transform ? transform.out(record[name]) : (record[name] ?? '');
  node.addEventListener('input', () => {
    record[name] = transform ? transform.in(node.value) : node.value;
    markDirty();
    if (name === 'name') refreshTitle();
  });
  inputs[name] = node;
  return node;
}

const moneyT = { out: (v) => moneyInput(v), in: (v) => parseMoney(v) };
const rateT = { out: (v) => (v ? String(v) : ''), in: (v) => parseRate(v) };

const identity = el('div', { class: 'grid grid-2' },
  field('cust_name', bind('name', el('input', { type: 'text', id: 'f-name', autofocus: isNew }))),
  field('cust_company', bind('company', el('input', { type: 'text' }))),
  field('cust_account', bind('account', el('input', { type: 'text', class: 'input-mono' }))),
  field('cust_contact', bind('contact', el('input', { type: 'text' }))),
);

const contact = el('div', { class: 'grid grid-3' },
  field('cust_phone', bind('phone', el('input', { type: 'tel' }))),
  field('cust_mobile', bind('mobile', el('input', { type: 'tel' }))),
  field('cust_email', bind('email', el('input', { type: 'email' }))),
);

const address = el('div', {},
  el('div', { class: 'grid grid-2' },
    field('cust_address', bind('address', el('input', { type: 'text' }))),
    field('cust_address2', bind('address2', el('input', { type: 'text' }))),
  ),
  el('div', { class: 'grid grid-4' },
    field('cust_city', bind('city', el('input', { type: 'text' }))),
    field('cust_state', bind('state', el('input', { type: 'text' }))),
    field('cust_zip', bind('zip', el('input', { type: 'text' }))),
    field('cust_country', bind('country', el('input', { type: 'text' }))),
  ),
);

const exemptBox = el('input', { type: 'checkbox', checked: !!record.taxExempt });
exemptBox.addEventListener('change', () => { record.taxExempt = exemptBox.checked; markDirty(); });

const activeBox = el('input', { type: 'checkbox', checked: record.active !== false });
activeBox.addEventListener('change', () => { record.active = activeBox.checked; markDirty(); });

const terms = el('div', { class: 'grid grid-3' },
  field('terms', bind('terms', el('input', { type: 'text' }))),
  field('cust_discount', bind('discountPct', el('input', { type: 'text', class: 'input-num', inputmode: 'decimal' }), rateT)),
  field('cust_credit_limit', bind('creditLimitCents', el('input', { type: 'text', class: 'input-money', inputmode: 'decimal' }), moneyT)),
);

const flags = el('div', { class: 'form-row' },
  el('label', { class: 'check' }, exemptBox, el('span', { html: L('cust_tax_exempt') })),
  el('label', { class: 'check' }, activeBox, el('span', { html: L('item_active') })),
);

const notes = bind('notes', el('textarea', { rows: 3 }));

page.append(card(null, el('div', {},
  identity, contact, address, terms, flags,
  el('div', { class: 'mt-2' }, field('notes', notes)),
)));

// ---------------------------------------------------------------------------
// History (existing customers only)
// ---------------------------------------------------------------------------

if (!isNew) {
  const historyHost = el('div', {});
  page.append(historyHost);
  historyHost.append(spinner());
  renderHistory(historyHost).catch((err) => {
    console.error(err);
    historyHost.innerHTML = '';
  });
}

async function renderHistory(host) {
  const [rawInvoices, rawPayments, rawQuotes] = await Promise.all([
    loadAll('invoices', where('customerId', '==', p.id)),
    loadAll('payments', where('customerId', '==', p.id)),
    loadAll('quotes', where('customerId', '==', p.id)),
  ]);
  const invoices = byDateDesc(rawInvoices);
  const payments = byDateDesc(rawPayments);
  const quotes = byDateDesc(rawQuotes);

  const openBalance = invoices
    .filter((i) => !i.voided && i.status !== 'draft')
    .reduce((s, i) => s + (Number(i.balanceCents) || 0), 0);
  const totalSales = invoices
    .filter((i) => !i.voided && i.status !== 'draft')
    .reduce((s, i) => s + (Number(i.totalCents) || 0), 0);
  const lastSale = invoices.length ? invoices[0].date : '';

  host.innerHTML = '';

  host.append(el('div', { class: 'stat-row' },
    el('div', { class: 'stat' + (openBalance > 0 ? ' stat--warn' : '') },
      el('div', { class: 'stat-label', html: L('cust_open_balance') }),
      el('div', { class: 'stat-value', text: money(openBalance) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('cust_total_sales') }),
      el('div', { class: 'stat-value', text: money(totalSales) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('cust_last_sale') }),
      el('div', { class: 'stat-value', text: lastSale ? fmtDate(lastSale) : '—' })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('nav_invoices') }),
      el('div', { class: 'stat-value', text: String(invoices.length) })),
  ));

  host.append(card('nav_invoices', dataTable({
    columns: [
      { key: 'number', labelKey: 'invoice_number', className: 'nowrap',
        html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', html: (r) => esc(fmtDate(r.date)) },
      { key: 'totalCents', labelKey: 'total', className: 'num', html: (r) => esc(money(r.totalCents)) },
      { key: 'balanceCents', labelKey: 'balance_due', className: 'num', html: (r) => esc(money(r.balanceCents)) },
      { key: 'status', labelKey: 'status', className: 'nowrap', html: (r) => statusPill(r) },
    ],
    rows: invoices.slice(0, 25),
    onRowClick: (r) => { location.href = `invoice.html?id=${encodeURIComponent(r.id)}`; },
    rowClass: (r) => (r.voided ? 'is-void' : ''),
  }), { flush: true }));

  if (payments.length) {
    host.append(card('nav_payments', dataTable({
      columns: [
        { key: 'number', labelKey: 'payment_number', className: 'nowrap',
          html: (r) => `<span class="input-mono">${esc(r.number || '—')}</span>` },
        { key: 'date', labelKey: 'date', className: 'nowrap', html: (r) => esc(fmtDate(r.date)) },
        { key: 'method', labelKey: 'pay_method', html: (r) => esc(r.method || '') },
        { key: 'reference', labelKey: 'reference', className: 'cell-muted', html: (r) => esc(r.reference || '') },
        { key: 'amountCents', labelKey: 'amount', className: 'num', html: (r) => esc(money(r.amountCents)) },
      ],
      rows: payments.slice(0, 25),
      onRowClick: (r) => { location.href = `payment.html?id=${encodeURIComponent(r.id)}`; },
    }), { flush: true }));
  }

  if (quotes.length) {
    host.append(card('nav_quotes', dataTable({
      columns: [
        { key: 'number', labelKey: 'quote_number', className: 'nowrap',
          html: (r) => `<span class="input-mono">${esc(r.number || '—')}</span>` },
        { key: 'date', labelKey: 'date', className: 'nowrap', html: (r) => esc(fmtDate(r.date)) },
        { key: 'totalCents', labelKey: 'total', className: 'num', html: (r) => esc(money(r.totalCents)) },
        { key: 'status', labelKey: 'status', className: 'nowrap', html: (r) => statusPill(r) },
      ],
      rows: quotes.slice(0, 15),
      onRowClick: (r) => { location.href = `quote.html?id=${encodeURIComponent(r.id)}`; },
    }), { flush: true }));
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function refreshTitle() {
  const h1 = header.querySelector('h1');
  h1.innerHTML = `${L('customer')} ${record.name ? `<span style="font-weight:700">${esc(record.name)}</span>` : ''}`;
}

async function save({ stay = false } = {}) {
  if (!String(record.name || '').trim() && !String(record.company || '').trim()) {
    toast('Enter a name.', 'warn');
    inputs.name.focus();
    return null;
  }
  const payload = { ...record };
  payload.searchBlob = customerSearchBlob(payload);
  try {
    const id = await saveRecord('customers', record.id, payload);
    record.id = id;
    dirty = false;
    invalidateStore();
    toastKey('msg_saved');
    if (!stay) { location.href = 'customers.html'; return id; }
    if (!p.id) history.replaceState({}, '', `customer.html?id=${encodeURIComponent(id)}`);
    return id;
  } catch (err) {
    console.error(err);
    toast(`Could not save.`, 'err');
    return null;
  }
}

async function destroy() {
  const open = await loadAll('invoices', where('customerId', '==', record.id), limit(1));
  const warn = open.length
    ? '<br><span class="text-red">This customer has invoices. Consider marking them inactive instead.</span>'
    : '';
  const ok = await confirmDialog(`${L('msg_confirm_delete')}<br><strong>${esc(record.name)}</strong>${warn}`,
    { danger: true, okKey: 'act_delete' });
  if (!ok) return;
  await removeRecord('customers', record.id);
  invalidateStore();
  dirty = false;
  toastKey('msg_deleted');
  location.href = 'customers.html';
}

async function newDoc(type) {
  const id = record.id || await save({ stay: true });
  if (!id) return;
  location.href = `${type}.html?new=1&customer=${encodeURIComponent(id)}`;
}

async function goStatement() {
  const id = record.id || await save({ stay: true });
  if (!id) return;
  location.href = `statements.html?customer=${encodeURIComponent(id)}`;
}

onAction('save', () => save({ stay: true }));
onAction('saveClose', () => save({ stay: false }));
