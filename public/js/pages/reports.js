import {
  $, el, esc, biInline, T, es, en,
  initShell, pageHeader, setPageTitle, params,
  money, fmtQty, fmtDate, today, monthStart, monthEnd, yearStart, yearEnd, addMonths, fromIso, iso,
  loadAll, orderBy, limit, getSettings,
  onAction, toast, toCSV, downloadFile, spinner, daysBetween,
} from '../app.js';
import {
  displayStatus, statusKey, AGING_BUCKETS, agingBucket, PAYMENT_METHODS,
} from '../model.js';
import { dataTable, selectEl, statusPill } from '../components.js';

setPageTitle('nav_reports');
await initShell('reports.html');

const page = $('#page');
const p = params();

const REPORTS = [
  { id: 'summary', labelKey: 'rep_sales_summary' },
  { id: 'customer', labelKey: 'rep_sales_by_customer' },
  { id: 'item', labelKey: 'rep_sales_by_item' },
  { id: 'unpaid', labelKey: 'rep_unpaid' },
  { id: 'aged', labelKey: 'rep_aged' },
  { id: 'payments', labelKey: 'rep_payments' },
  { id: 'tax', labelKey: 'rep_tax' },
  { id: 'quotes', labelKey: 'rep_quote_conversion' },
];

const state = {
  report: REPORTS.some((r) => r.id === p.report) ? p.report : 'summary',
  from: p.from || yearStart(),
  to: p.to || today(),
};

let lastRows = [];
let lastHeader = [];

page.append(pageHeader('nav_reports', [
  { key: 'act_export_csv', onClick: () => exportCsv() },
  { key: 'act_print', accel: 'Ctrl+P', onClick: () => window.print() },
]));

// ---- Controls --------------------------------------------------------------

const reportSelect = selectEl(
  REPORTS.map((r) => ({ value: r.id, labelKey: r.labelKey, selected: r.id === state.report })),
);
reportSelect.addEventListener('change', () => { state.report = reportSelect.value; run(); });

const fromInput = el('input', { type: 'date', value: state.from });
const toInput = el('input', { type: 'date', value: state.to });
fromInput.addEventListener('change', () => { state.from = fromInput.value; run(); });
toInput.addEventListener('change', () => { state.to = toInput.value; run(); });

const periodSelect = selectEl([
  { value: 'year', labelKey: 'rep_this_year' },
  { value: 'month', labelKey: 'rep_this_month' },
  { value: 'lastmonth', labelKey: 'rep_last_month' },
  { value: 'quarter', labelKey: 'rep_this_quarter' },
  { value: 'lastyear', labelKey: 'rep_last_year' },
  { value: 'custom', labelKey: 'rep_custom' },
]);
periodSelect.addEventListener('change', () => {
  const now = today();
  const map = {
    month: [monthStart(now), monthEnd(now)],
    lastmonth: [monthStart(addMonths(now, -1)), monthEnd(addMonths(now, -1))],
    quarter: (() => {
      const d = fromIso(now);
      const q = Math.floor(d.getMonth() / 3);
      return [iso(new Date(d.getFullYear(), q * 3, 1)), iso(new Date(d.getFullYear(), q * 3 + 3, 0))];
    })(),
    year: [yearStart(now), yearEnd(now)],
    lastyear: (() => {
      const y = fromIso(now).getFullYear() - 1;
      return [`${y}-01-01`, `${y}-12-31`];
    })(),
  };
  if (map[periodSelect.value]) {
    [state.from, state.to] = map[periodSelect.value];
    fromInput.value = state.from;
    toInput.value = state.to;
  }
  run();
});

page.append(el('div', { class: 'card' },
  el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: biInline('nav_reports') }), reportSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: biInline('rep_period') }), periodSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: biInline('date_from') }), fromInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: biInline('date_to') }), toInput),
  ),
));

const resultHost = el('div', {});
page.append(resultHost);

// ---- Data ------------------------------------------------------------------

let invoices = null;
let payments = null;
let quotes = null;

async function ensureData(kinds) {
  const jobs = [];
  if (kinds.includes('invoices') && !invoices) {
    jobs.push(loadAll('invoices', orderBy('date', 'desc'), limit(4000)).then((r) => { invoices = r; }));
  }
  if (kinds.includes('payments') && !payments) {
    jobs.push(loadAll('payments', orderBy('date', 'desc'), limit(4000)).then((r) => { payments = r; }));
  }
  if (kinds.includes('quotes') && !quotes) {
    jobs.push(loadAll('quotes', orderBy('date', 'desc'), limit(2000)).then((r) => { quotes = r; }));
  }
  await Promise.all(jobs);
}

const live = (inv) => !inv.voided && inv.status !== 'draft';
const inRange = (d) => (!state.from || d >= state.from) && (!state.to || d <= state.to);

// ---- Runner ----------------------------------------------------------------

await run();

async function run() {
  resultHost.innerHTML = '';
  resultHost.append(spinner());
  const url = new URL(location.href);
  url.searchParams.set('report', state.report);
  url.searchParams.set('from', state.from);
  url.searchParams.set('to', state.to);
  history.replaceState({}, '', url);

  try {
    const builders = {
      summary: buildSummary,
      customer: buildByCustomer,
      item: buildByItem,
      unpaid: buildUnpaid,
      aged: buildAged,
      payments: buildPayments,
      tax: buildTax,
      quotes: buildQuoteConversion,
    };
    const node = await builders[state.report]();
    resultHost.innerHTML = '';
    resultHost.append(node);
  } catch (err) {
    console.error('Report failed', err);
    resultHost.innerHTML = '';
    resultHost.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('p', { html: 'No se pudo generar el informe. <span class="bi-en-inline">Could not build the report.</span>' }),
      el('p', { class: 'text-small text-muted', text: err.message || '' }),
    )));
  }
}

function reportCard(titleKey, tableNode, summaryNode) {
  return el('div', {},
    summaryNode || null,
    el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { html: biInline(titleKey) }),
        el('span', { class: 'text-small text-muted',
          text: `${fmtDate(state.from)} — ${fmtDate(state.to)}` }),
      ),
      tableNode,
    ),
  );
}

function noRows() {
  return el('div', { class: 'empty', html: `<p>${biInline('rep_no_rows')}</p>` });
}

// ===========================================================================
// Sales summary, by month
// ===========================================================================

async function buildSummary() {
  await ensureData(['invoices']);
  const rows = invoices.filter((i) => live(i) && inRange(i.date));

  const byMonth = new Map();
  for (const inv of rows) {
    const key = String(inv.date).slice(0, 7);
    const bucket = byMonth.get(key) || { month: key, count: 0, subtotal: 0, tax: 0, total: 0, paid: 0 };
    bucket.count += 1;
    bucket.subtotal += Number(inv.subtotalCents) || 0;
    bucket.tax += Number(inv.taxCents) || 0;
    bucket.total += Number(inv.totalCents) || 0;
    bucket.paid += Number(inv.paidCents) || 0;
    byMonth.set(key, bucket);
  }
  const list = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  lastHeader = ['Mes / Month', 'Cantidad / Count', 'Subtotal', 'Impuesto / Tax', 'Total', 'Pagado / Paid'];
  lastRows = list.map((r) => [r.month, r.count, r.subtotal / 100, r.tax / 100, r.total / 100, r.paid / 100]);

  const totals = list.reduce((acc, r) => ({
    count: acc.count + r.count, subtotal: acc.subtotal + r.subtotal,
    tax: acc.tax + r.tax, total: acc.total + r.total, paid: acc.paid + r.paid,
  }), { count: 0, subtotal: 0, tax: 0, total: 0, paid: 0 });

  const summary = el('div', { class: 'stat-row' },
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('total') }),
      el('div', { class: 'stat-value', text: money(totals.total) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('nav_invoices') }),
      el('div', { class: 'stat-value', text: String(totals.count) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('tax') }),
      el('div', { class: 'stat-value', text: money(totals.tax) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('amount_paid') }),
      el('div', { class: 'stat-value', text: money(totals.paid) })),
  );

  if (!list.length) return reportCard('rep_sales_summary', noRows(), summary);

  return reportCard('rep_sales_summary', dataTable({
    columns: [
      { key: 'month', label: 'Mes / Month', className: 'nowrap', sortable: false,
        html: (r) => esc(monthLabel(r.month)) },
      { key: 'count', labelKey: 'rep_count', className: 'num', sortable: false,
        html: (r) => String(r.count), footer: () => String(totals.count) },
      { key: 'subtotal', labelKey: 'subtotal', className: 'num', sortable: false,
        html: (r) => esc(money(r.subtotal)), footer: () => esc(money(totals.subtotal)) },
      { key: 'tax', labelKey: 'tax', className: 'num', sortable: false,
        html: (r) => esc(money(r.tax)), footer: () => esc(money(totals.tax)) },
      { key: 'total', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.total))}</strong>`, footer: () => esc(money(totals.total)) },
      { key: 'paid', labelKey: 'amount_paid', className: 'num', sortable: false,
        html: (r) => esc(money(r.paid)), footer: () => esc(money(totals.paid)) },
    ],
    rows: list,
  }), summary);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  const names = ['Ene/Jan', 'Feb/Feb', 'Mar/Mar', 'Abr/Apr', 'May/May', 'Jun/Jun',
    'Jul/Jul', 'Ago/Aug', 'Sep/Sep', 'Oct/Oct', 'Nov/Nov', 'Dic/Dec'];
  return `${names[Number(m) - 1] || m} ${y}`;
}

// ===========================================================================
// Sales by customer
// ===========================================================================

async function buildByCustomer() {
  await ensureData(['invoices']);
  const rows = invoices.filter((i) => live(i) && inRange(i.date));

  const byCustomer = new Map();
  for (const inv of rows) {
    const key = inv.customerId || inv.customerName || '—';
    const bucket = byCustomer.get(key) || {
      id: inv.customerId, name: inv.customerName || '—', count: 0, total: 0, paid: 0, balance: 0,
    };
    bucket.count += 1;
    bucket.total += Number(inv.totalCents) || 0;
    bucket.paid += Number(inv.paidCents) || 0;
    bucket.balance += Number(inv.balanceCents) || 0;
    byCustomer.set(key, bucket);
  }
  const list = [...byCustomer.values()].sort((a, b) => b.total - a.total);

  lastHeader = ['Cliente / Customer', 'Facturas / Invoices', 'Total', 'Pagado / Paid', 'Saldo / Balance'];
  lastRows = list.map((r) => [r.name, r.count, r.total / 100, r.paid / 100, r.balance / 100]);

  if (!list.length) return reportCard('rep_sales_by_customer', noRows());

  return reportCard('rep_sales_by_customer', dataTable({
    columns: [
      { key: 'name', labelKey: 'customer', sortable: false,
        html: (r) => r.id
          ? `<a href="customer.html?id=${encodeURIComponent(r.id)}">${esc(r.name)}</a>`
          : esc(r.name) },
      { key: 'count', labelKey: 'rep_count', className: 'num', sortable: false,
        html: (r) => String(r.count),
        footer: (l) => String(l.reduce((s, r) => s + r.count, 0)) },
      { key: 'total', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.total))}</strong>`,
        footer: (l) => esc(money(l.reduce((s, r) => s + r.total, 0))) },
      { key: 'paid', labelKey: 'amount_paid', className: 'num', sortable: false,
        html: (r) => esc(money(r.paid)),
        footer: (l) => esc(money(l.reduce((s, r) => s + r.paid, 0))) },
      { key: 'balance', labelKey: 'balance_due', className: 'num', sortable: false,
        html: (r) => esc(money(r.balance)),
        footer: (l) => esc(money(l.reduce((s, r) => s + r.balance, 0))) },
    ],
    rows: list,
  }));
}

// ===========================================================================
// Sales by item
// ===========================================================================

async function buildByItem() {
  await ensureData(['invoices']);
  const rows = invoices.filter((i) => live(i) && inRange(i.date));

  const byItem = new Map();
  for (const inv of rows) {
    for (const line of inv.lines || []) {
      const key = (line.code || '').trim() || (line.description || '').trim().slice(0, 60) || '—';
      const bucket = byItem.get(key) || { code: line.code || '', description: line.description || '', qty: 0, total: 0, count: 0 };
      bucket.qty += Number(line.qty) || 0;
      bucket.total += Number(line.amountCents) || 0;
      bucket.count += 1;
      if (!bucket.description && line.description) bucket.description = line.description;
      byItem.set(key, bucket);
    }
  }
  const list = [...byItem.values()].sort((a, b) => b.total - a.total);

  lastHeader = ['Código / Code', 'Descripción / Description', 'Cantidad / Qty', 'Veces / Times', 'Total'];
  lastRows = list.map((r) => [r.code, firstLine(r.description), r.qty, r.count, r.total / 100]);

  if (!list.length) return reportCard('rep_sales_by_item', noRows());

  return reportCard('rep_sales_by_item', dataTable({
    columns: [
      { key: 'code', labelKey: 'item_code', className: 'nowrap', sortable: false,
        html: (r) => `<strong class="input-mono">${esc(r.code || '—')}</strong>` },
      { key: 'description', labelKey: 'item_description', sortable: false,
        html: (r) => esc(firstLine(r.description)) },
      { key: 'qty', labelKey: 'line_qty', className: 'num', sortable: false,
        html: (r) => esc(fmtQty(r.qty)),
        footer: (l) => esc(fmtQty(l.reduce((s, r) => s + r.qty, 0))) },
      { key: 'count', labelKey: 'rep_count', className: 'num cell-muted', sortable: false,
        html: (r) => String(r.count) },
      { key: 'total', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.total))}</strong>`,
        footer: (l) => esc(money(l.reduce((s, r) => s + r.total, 0))) },
    ],
    rows: list,
  }));
}

function firstLine(s) {
  return String(s || '').split('\n')[0];
}

// ===========================================================================
// Unpaid invoices
// ===========================================================================

async function buildUnpaid() {
  await ensureData(['invoices']);
  const asOf = today();
  const list = invoices
    .filter((i) => live(i) && (Number(i.balanceCents) || 0) > 0)
    .sort((a, b) => String(a.dueDate || a.date).localeCompare(String(b.dueDate || b.date)));

  lastHeader = ['Factura / Invoice', 'Fecha / Date', 'Vence / Due', 'Cliente / Customer', 'Total', 'Saldo / Balance', 'Días / Days'];
  lastRows = list.map((r) => [
    r.number, r.date, r.dueDate, r.customerName,
    (Number(r.totalCents) || 0) / 100, (Number(r.balanceCents) || 0) / 100,
    Math.max(0, daysBetween(r.dueDate || r.date, asOf)),
  ]);

  if (!list.length) return reportCard('rep_unpaid', noRows());

  return reportCard('rep_unpaid', dataTable({
    columns: [
      { key: 'number', labelKey: 'invoice_number', className: 'nowrap', sortable: false,
        html: (r) => `<a href="invoice.html?id=${encodeURIComponent(r.id)}" class="input-mono"><strong>${esc(r.number || '—')}</strong></a>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false, html: (r) => esc(fmtDate(r.date)) },
      { key: 'dueDate', labelKey: 'due_date', className: 'nowrap', sortable: false, html: (r) => esc(fmtDate(r.dueDate)) },
      { key: 'customerName', labelKey: 'customer', sortable: false, html: (r) => esc(r.customerName || '—') },
      { key: 'totalCents', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => esc(money(r.totalCents)),
        footer: (l) => esc(money(l.reduce((s, r) => s + (Number(r.totalCents) || 0), 0))) },
      { key: 'balanceCents', labelKey: 'balance_due', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.balanceCents))}</strong>`,
        footer: (l) => esc(money(l.reduce((s, r) => s + (Number(r.balanceCents) || 0), 0))) },
      { key: 'status', labelKey: 'status', className: 'nowrap', sortable: false,
        html: (r) => statusPill(r, asOf) },
    ],
    rows: list,
    onRowClick: (r) => { location.href = `invoice.html?id=${encodeURIComponent(r.id)}`; },
  }));
}

// ===========================================================================
// Aged receivables
// ===========================================================================

async function buildAged() {
  await ensureData(['invoices']);
  const asOf = state.to || today();
  const open = invoices.filter((i) => live(i) && (Number(i.balanceCents) || 0) > 0);

  const byCustomer = new Map();
  for (const inv of open) {
    const key = inv.customerId || inv.customerName || '—';
    const bucket = byCustomer.get(key) || {
      id: inv.customerId, name: inv.customerName || '—', buckets: AGING_BUCKETS.map(() => 0), total: 0,
    };
    const index = agingBucket(inv, asOf);
    bucket.buckets[index] += Number(inv.balanceCents) || 0;
    bucket.total += Number(inv.balanceCents) || 0;
    byCustomer.set(key, bucket);
  }
  const list = [...byCustomer.values()].sort((a, b) => b.total - a.total);

  lastHeader = ['Cliente / Customer', ...AGING_BUCKETS.map((b) => `${es(b.key)} / ${en(b.key)}`), 'Total'];
  lastRows = list.map((r) => [r.name, ...r.buckets.map((c) => c / 100), r.total / 100]);

  if (!list.length) return reportCard('rep_aged', noRows());

  const columns = [
    { key: 'name', labelKey: 'customer', sortable: false,
      html: (r) => r.id ? `<a href="customer.html?id=${encodeURIComponent(r.id)}">${esc(r.name)}</a>` : esc(r.name) },
  ];
  AGING_BUCKETS.forEach((b, i) => {
    columns.push({
      key: `b${i}`, labelKey: b.key, className: 'num', sortable: false,
      html: (r) => (r.buckets[i] ? esc(money(r.buckets[i])) : '<span class="cell-muted">—</span>'),
      footer: (l) => esc(money(l.reduce((s, r) => s + r.buckets[i], 0))),
    });
  });
  columns.push({
    key: 'total', labelKey: 'total', className: 'num', sortable: false,
    html: (r) => `<strong>${esc(money(r.total))}</strong>`,
    footer: (l) => esc(money(l.reduce((s, r) => s + r.total, 0))),
  });

  return reportCard('rep_aged', dataTable({ columns, rows: list }),
    el('p', { class: 'text-small text-muted mb-1',
      html: `Antigüedad calculada al ${esc(fmtDate(asOf))}. <span class="bi-en-inline">Aged as of ${esc(fmtDate(asOf))}.</span>` }));
}

// ===========================================================================
// Payments received
// ===========================================================================

async function buildPayments() {
  await ensureData(['payments']);
  const list = payments.filter((r) => inRange(r.date))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const byMethod = new Map();
  for (const pay of list) {
    const key = pay.method || 'other';
    byMethod.set(key, (byMethod.get(key) || 0) + (Number(pay.amountCents) || 0));
  }

  lastHeader = ['Pago / Payment', 'Fecha / Date', 'Cliente / Customer', 'Forma / Method', 'Referencia / Reference', 'Monto / Amount'];
  lastRows = list.map((r) => [
    r.number, r.date, r.customerName, methodLabel(r.method), r.reference, (Number(r.amountCents) || 0) / 100,
  ]);

  const summary = el('div', { class: 'stat-row' },
    ...PAYMENT_METHODS
      .filter((m) => byMethod.get(m.value))
      .map((m) => el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: biInline(m.key) }),
        el('div', { class: 'stat-value', text: money(byMethod.get(m.value)) }),
      )),
    el('div', { class: 'stat stat--good' },
      el('div', { class: 'stat-label', html: biInline('total') }),
      el('div', { class: 'stat-value', text: money(list.reduce((s, r) => s + (Number(r.amountCents) || 0), 0)) }),
    ),
  );

  if (!list.length) return reportCard('rep_payments', noRows(), summary);

  return reportCard('rep_payments', dataTable({
    columns: [
      { key: 'number', labelKey: 'payment_number', className: 'nowrap', sortable: false,
        html: (r) => `<a href="payment.html?id=${encodeURIComponent(r.id)}" class="input-mono">${esc(r.number || '—')}</a>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false, html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', sortable: false, html: (r) => esc(r.customerName || '—') },
      { key: 'method', labelKey: 'pay_method', className: 'nowrap', sortable: false,
        html: (r) => esc(methodLabel(r.method)) },
      { key: 'reference', labelKey: 'reference', className: 'cell-muted', sortable: false,
        html: (r) => esc(r.reference || '') },
      { key: 'amountCents', labelKey: 'amount', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.amountCents))}</strong>`,
        footer: (l) => esc(money(l.reduce((s, r) => s + (Number(r.amountCents) || 0), 0))) },
    ],
    rows: list,
  }), summary);
}

function methodLabel(value) {
  const m = PAYMENT_METHODS.find((x) => x.value === value);
  return m ? T(m.key) : (value || '');
}

// ===========================================================================
// Tax report
// ===========================================================================

async function buildTax() {
  await ensureData(['invoices']);
  const rows = invoices.filter((i) => live(i) && inRange(i.date));

  const byMonth = new Map();
  for (const inv of rows) {
    const key = String(inv.date).slice(0, 7);
    const bucket = byMonth.get(key) || { month: key, taxable: 0, exempt: 0, tax1: 0, tax2: 0, total: 0 };
    const taxable = Number(inv.taxableCents) || 0;
    bucket.taxable += taxable;
    bucket.exempt += Math.max(0, (Number(inv.subtotalCents) || 0) - (Number(inv.discountCents) || 0) - taxable);
    bucket.tax1 += Number(inv.tax1Cents) || 0;
    bucket.tax2 += Number(inv.tax2Cents) || 0;
    bucket.total += Number(inv.totalCents) || 0;
    byMonth.set(key, bucket);
  }
  const list = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  const settings = await getSettings();

  lastHeader = ['Mes / Month', 'Gravable / Taxable', 'Exento / Exempt',
    settings.tax1Name || 'Tax 1', settings.tax2Name || 'Tax 2', 'Total'];
  lastRows = list.map((r) => [r.month, r.taxable / 100, r.exempt / 100, r.tax1 / 100, r.tax2 / 100, r.total / 100]);

  if (!list.length) return reportCard('rep_tax', noRows());

  const columns = [
    { key: 'month', label: 'Mes / Month', className: 'nowrap', sortable: false,
      html: (r) => esc(monthLabel(r.month)) },
    { key: 'taxable', label: `${es('line_taxable')} / ${en('item_taxable')}`, className: 'num', sortable: false,
      html: (r) => esc(money(r.taxable)), footer: (l) => esc(money(l.reduce((s, r) => s + r.taxable, 0))) },
    { key: 'exempt', label: `${es('cust_tax_exempt')} / ${en('cust_tax_exempt')}`, className: 'num cell-muted', sortable: false,
      html: (r) => esc(money(r.exempt)), footer: (l) => esc(money(l.reduce((s, r) => s + r.exempt, 0))) },
    { key: 'tax1', label: settings.tax1Name || 'Tax 1', className: 'num', sortable: false,
      html: (r) => `<strong>${esc(money(r.tax1))}</strong>`, footer: (l) => esc(money(l.reduce((s, r) => s + r.tax1, 0))) },
  ];
  if (Number(settings.tax2Rate) > 0) {
    columns.push({ key: 'tax2', label: settings.tax2Name || 'Tax 2', className: 'num', sortable: false,
      html: (r) => esc(money(r.tax2)), footer: (l) => esc(money(l.reduce((s, r) => s + r.tax2, 0))) });
  }
  columns.push({ key: 'total', labelKey: 'total', className: 'num', sortable: false,
    html: (r) => esc(money(r.total)), footer: (l) => esc(money(l.reduce((s, r) => s + r.total, 0))) });

  return reportCard('rep_tax', dataTable({ columns, rows: list }));
}

// ===========================================================================
// Quote conversion
// ===========================================================================

async function buildQuoteConversion() {
  await ensureData(['quotes']);
  const asOf = today();
  const list = quotes.filter((q) => inRange(q.date))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const counts = { open: 0, accepted: 0, converted: 0, declined: 0, expired: 0, cancelled: 0, void: 0 };
  let convertedValue = 0;
  let totalValue = 0;
  for (const q of list) {
    const status = displayStatus(q, asOf);
    counts[status] = (counts[status] || 0) + 1;
    totalValue += Number(q.totalCents) || 0;
    if (status === 'converted' || status === 'accepted') convertedValue += Number(q.totalCents) || 0;
  }
  const rate = list.length ? Math.round(((counts.converted || 0) / list.length) * 100) : 0;

  lastHeader = ['Cotización / Quote', 'Fecha / Date', 'Cliente / Customer', 'Total', 'Estado / Status'];
  lastRows = list.map((r) => [
    r.number, r.date, r.customerName, (Number(r.totalCents) || 0) / 100,
    `${es(statusKey(displayStatus(r, asOf)))} / ${en(statusKey(displayStatus(r, asOf)))}`,
  ]);

  const summary = el('div', { class: 'stat-row' },
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('nav_quotes') }),
      el('div', { class: 'stat-value', text: String(list.length) })),
    el('div', { class: 'stat stat--good' },
      el('div', { class: 'stat-label', html: biInline('st_converted') }),
      el('div', { class: 'stat-value', text: `${rate}%` }),
      el('div', { class: 'stat-sub', text: `${counts.converted || 0} ${T('of')} ${list.length}` })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('total') }),
      el('div', { class: 'stat-value', text: money(totalValue) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: biInline('st_accepted') }),
      el('div', { class: 'stat-value', text: money(convertedValue) })),
  );

  if (!list.length) return reportCard('rep_quote_conversion', noRows(), summary);

  return reportCard('rep_quote_conversion', dataTable({
    columns: [
      { key: 'number', labelKey: 'quote_number', className: 'nowrap', sortable: false,
        html: (r) => `<a href="quote.html?id=${encodeURIComponent(r.id)}" class="input-mono"><strong>${esc(r.number || '—')}</strong></a>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false, html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', sortable: false, html: (r) => esc(r.customerName || '—') },
      { key: 'totalCents', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => esc(money(r.totalCents)),
        footer: (l) => esc(money(l.reduce((s, r) => s + (Number(r.totalCents) || 0), 0))) },
      { key: 'status', labelKey: 'status', className: 'nowrap', sortable: false,
        html: (r) => statusPill(r, asOf) },
    ],
    rows: list,
    onRowClick: (r) => { location.href = `quote.html?id=${encodeURIComponent(r.id)}`; },
  }), summary);
}

// ===========================================================================

function exportCsv() {
  if (!lastRows.length) {
    toast(T('rep_no_rows'), 'warn');
    return;
  }
  const name = REPORTS.find((r) => r.id === state.report);
  downloadFile(
    `${state.report}-${state.from}-${state.to}.csv`,
    '﻿' + toCSV([
      [`${es(name.labelKey)} / ${en(name.labelKey)}`],
      [`${es('date_from')} ${state.from}`, `${es('date_to')} ${state.to}`],
      [],
      lastHeader,
      ...lastRows,
    ]),
  );
}

onAction('print', () => window.print());
