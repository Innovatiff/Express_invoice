import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  fmtDate, today, loadAll, orderBy, limit, matchesSearch, debounce,
  spinner, toast,
} from '../app.js';

import {
  dataTable, statusPill, card,
} from '../components.js';

setPageTitle('act_search');
await initShell('');

const page = $('#page');
const p = params();

let term = p.q || '';

page.append(pageHeader('act_search', [], term));

const input = el('input', {
  type: 'search', id: 'list-search', value: term,
  placeholder: `${T('act_search')}`,
  style: 'max-width:420px',
});
input.addEventListener('input', debounce(() => {
  term = input.value;
  const url = new URL(location.href);
  url.searchParams.set('q', term);
  history.replaceState({}, '', url);
  render();
}, 180));

page.append(el('div', { class: 'card' },
  el('div', { class: 'filters' },
    el('div', { class: 'field flex-1' },
      el('label', { class: 'field-label', html: L('act_search') }), input)),
));

const resultHost = el('div', {});
page.append(resultHost);
resultHost.append(spinner());

// Everything is searched in memory. For a single shop this is a handful of
// megabytes and it keeps the search instant and typo-forgiving, which a
// Firestore prefix query could not be.
let data = { customers: [], items: [], invoices: [], quotes: [], orders: [], payments: [] };

try {
  const [customers, items, invoices, quotes, orders, payments] = await Promise.all([
    loadAll('customers', orderBy('name')),
    loadAll('items', orderBy('code')),
    loadAll('invoices', orderBy('date', 'desc'), limit(2000)),
    loadAll('quotes', orderBy('date', 'desc'), limit(1000)),
    loadAll('orders', orderBy('date', 'desc'), limit(1000)),
    loadAll('payments', orderBy('date', 'desc'), limit(1000)),
  ]);
  data = { customers, items, invoices, quotes, orders, payments };
} catch (err) {
  console.error(err);
  toast('Could not load.', 'err');
}

render();
setTimeout(() => input.focus(), 40);

function render() {
  resultHost.innerHTML = '';

  if (!term.trim()) {
    resultHost.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'empty', html:
        '<p>Type to search invoices, quotes, orders, payments, customers and items.</p>' }))));
    return;
  }

  const asOf = today();
  let found = 0;

  const docBlob = (d) => d.searchBlob ||
    [d.number, d.customerName, d.poNumber, d.salesPerson,
      ...(d.lines || []).map((l) => `${l.code} ${l.description}`)].filter(Boolean).join(' ').toLowerCase();

  const sections = [
    {
      titleKey: 'nav_invoices', page: 'invoice.html',
      rows: data.invoices.filter((d) => matchesSearch(docBlob(d), term)).slice(0, 25),
      columns: docColumns('invoice_number', asOf, true),
    },
    {
      titleKey: 'nav_quotes', page: 'quote.html',
      rows: data.quotes.filter((d) => matchesSearch(docBlob(d), term)).slice(0, 15),
      columns: docColumns('quote_number', asOf, false),
    },
    {
      titleKey: 'nav_orders', page: 'order.html',
      rows: data.orders.filter((d) => matchesSearch(docBlob(d), term)).slice(0, 15),
      columns: docColumns('order_number', asOf, false),
    },
    {
      titleKey: 'nav_payments', page: 'payment.html',
      rows: data.payments.filter((d) => matchesSearch(
        [d.number, d.customerName, d.reference, d.notes,
          ...(d.allocations || []).map((a) => a.invoiceNumber)].filter(Boolean).join(' ').toLowerCase(), term)).slice(0, 15),
      columns: [
        { key: 'number', labelKey: 'payment_number', className: 'nowrap', sortable: false,
          html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
        { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false, html: (r) => esc(fmtDate(r.date)) },
        { key: 'customerName', labelKey: 'customer', sortable: false, html: (r) => esc(r.customerName || '—') },
        { key: 'amountCents', labelKey: 'amount', className: 'num', sortable: false,
          html: (r) => `<strong>${esc(money(r.amountCents))}</strong>` },
      ],
    },
    {
      titleKey: 'nav_customers', page: 'customer.html',
      rows: data.customers.filter((c) => matchesSearch(
        c.searchBlob || [c.name, c.company, c.phone, c.mobile, c.email, c.city].filter(Boolean).join(' ').toLowerCase(),
        term)).slice(0, 20),
      columns: [
        { key: 'name', labelKey: 'cust_name', sortable: false,
          html: (c) => `<strong>${esc(c.name || c.company || '—')}</strong>` },
        { key: 'phone', labelKey: 'cust_phone', className: 'nowrap', sortable: false,
          html: (c) => esc(c.phone || c.mobile || '') },
        { key: 'email', labelKey: 'cust_email', className: 'cell-muted', sortable: false,
          html: (c) => esc(c.email || '') },
        { key: 'city', labelKey: 'cust_city', className: 'cell-muted', sortable: false,
          html: (c) => esc([c.city, c.state].filter(Boolean).join(', ')) },
      ],
    },
    {
      titleKey: 'nav_items', page: 'item.html',
      rows: data.items.filter((i) => matchesSearch(
        i.searchBlob || [i.code, i.description, i.category].filter(Boolean).join(' ').toLowerCase(),
        term)).slice(0, 20),
      columns: [
        { key: 'code', labelKey: 'item_code', className: 'nowrap', sortable: false,
          html: (i) => `<strong class="input-mono">${esc(i.code || '—')}</strong>` },
        { key: 'description', labelKey: 'item_description', sortable: false,
          html: (i) => esc(String(i.description || '').split('\n')[0]) },
        { key: 'priceCents', labelKey: 'item_price', className: 'num', sortable: false,
          html: (i) => esc(money(i.priceCents)) },
      ],
    },
  ];

  for (const section of sections) {
    if (!section.rows.length) continue;
    found += section.rows.length;
    resultHost.append(card(section.titleKey, dataTable({
      columns: section.columns,
      rows: section.rows,
      onRowClick: (r) => { location.href = `${section.page}?id=${encodeURIComponent(r.id)}`; },
      rowClass: (r) => (r.voided ? 'is-void' : ''),
    }), {
      flush: true,
      headExtra: el('span', { class: 'text-small text-muted', text: String(section.rows.length) }),
    }));
  }

  if (!found) {
    resultHost.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'empty', html: `<p>${L('msg_no_results')}</p>` }))));
  }
}

function docColumns(numberKey, asOf, withBalance) {
  const columns = [
    { key: 'number', labelKey: numberKey, className: 'nowrap', sortable: false,
      html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
    { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false, html: (r) => esc(fmtDate(r.date)) },
    { key: 'customerName', labelKey: 'customer', sortable: false, html: (r) => esc(r.customerName || '—') },
    { key: 'totalCents', labelKey: 'total', className: 'num', sortable: false, html: (r) => esc(money(r.totalCents)) },
  ];
  if (withBalance) {
    columns.push({ key: 'balanceCents', labelKey: 'balance_due', className: 'num', sortable: false,
      html: (r) => esc(money(r.balanceCents)) });
  }
  columns.push({ key: 'status', labelKey: 'status', className: 'nowrap', sortable: false,
    html: (r) => statusPill(r, asOf) });
  return columns;
}
