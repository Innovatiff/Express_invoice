import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  fmtQty, fmtDate, today, monthStart, monthEnd, yearStart, yearEnd,
  addMonths, fromIso, iso, loadAll, orderBy, limit, getSettings, onAction,
  toast, toCSV, downloadFile, spinner, daysBetween,
} from '../app.js';
import {
  displayStatus, statusKey, AGING_BUCKETS, agingBucket, PAYMENT_METHODS,
} from '../model.js';
import {
  dataTable, selectEl, statusPill,
} from '../components.js';

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
  { id: 'quiet', labelKey: 'rep_quiet' },
  { id: 'payments', labelKey: 'rep_payments' },
  { id: 'tax', labelKey: 'rep_tax' },
  { id: 'quotes', labelKey: 'rep_quote_conversion' },
];

const state = {
  report: REPORTS.some((r) => r.id === p.report) ? p.report : 'summary',
  from: p.from || yearStart(),
  to: p.to || today(),
  // How long a customer has to have been silent before this report lists them.
  quietMonths: Number(p.quiet) > 0 ? Number(p.quiet) : 3,
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

const QUIET_CHOICES = [1, 2, 3, 4, 5, 6, 9, 12];
const quietSelect = selectEl(QUIET_CHOICES.map((n) => ({
  value: String(n), labelKey: `rep_months_${n}`, selected: n === state.quietMonths,
})));
quietSelect.addEventListener('change', () => {
  state.quietMonths = Number(quietSelect.value) || 3;
  run();
});
const quietField = el('div', { class: 'field hidden' },
  el('label', { class: 'field-label', html: L('rep_no_payment_in') }), quietSelect);

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
      el('label', { class: 'field-label', html: L('nav_reports') }), reportSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('rep_period') }), periodSelect),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_from') }), fromInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_to') }), toInput),
    quietField,
  ),
));

const resultHost = el('div', {});
page.append(resultHost);

// ---- Data ------------------------------------------------------------------

let invoices = null;
let payments = null;
let quotes = null;

/**
 * Reports read everything, with no cap.
 *
 * They used to take the newest few thousand of each. That is not a smaller
 * report, it is a wrong one, and it fails in the direction that looks
 * plausible: with ten years of history the cap fell somewhere in the middle,
 * so every payment older than it simply did not exist. Customers who had paid
 * faithfully for years came out as having never paid at all, and nothing on
 * the screen suggested anything had been left out.
 */
async function ensureData(kinds) {
  const jobs = [];
  if (kinds.includes('invoices') && !invoices) {
    jobs.push(loadAll('invoices', orderBy('date', 'desc')).then((r) => { invoices = r; }));
  }
  if (kinds.includes('payments') && !payments) {
    jobs.push(loadAll('payments', orderBy('date', 'desc')).then((r) => { payments = r; }));
  }
  if (kinds.includes('quotes') && !quotes) {
    jobs.push(loadAll('quotes', orderBy('date', 'desc')).then((r) => { quotes = r; }));
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
  // Only one report asks how long someone has been silent, so the control for
  // it only appears there rather than sitting inert on every other report.
  quietField.classList.toggle('hidden', state.report !== 'quiet');

  const url = new URL(location.href);
  url.searchParams.set('report', state.report);
  url.searchParams.set('from', state.from);
  url.searchParams.set('to', state.to);
  if (state.report === 'quiet') url.searchParams.set('quiet', String(state.quietMonths));
  else url.searchParams.delete('quiet');
  history.replaceState({}, '', url);

  try {
    const builders = {
      summary: buildSummary,
      customer: buildByCustomer,
      item: buildByItem,
      unpaid: buildUnpaid,
      aged: buildAged,
      quiet: buildQuiet,
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
      el('p', { html: 'Could not build the report.' }),
      el('p', { class: 'text-small text-muted', text: err.message || '' }),
    )));
  }
}

// `subtitle` overrides the date range in the card header. Reports that answer
// an "as of today" question rather than a "during this period" one pass their
// own, since printing a From date that changes nothing only misleads.
function reportCard(titleKey, tableNode, summaryNode, subtitle) {
  return el('div', {},
    summaryNode || null,
    el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { html: L(titleKey) }),
        el('span', { class: 'text-small text-muted',
          text: subtitle || `${fmtDate(state.from)} — ${fmtDate(state.to)}` }),
      ),
      tableNode,
    ),
  );
}

function noRows() {
  return el('div', { class: 'empty', html: `<p>${L('rep_no_rows')}</p>` });
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

  lastHeader = ['Month', 'Count', 'Subtotal', 'Tax', 'Total', 'Paid'];
  lastRows = list.map((r) => [r.month, r.count, r.subtotal / 100, r.tax / 100, r.total / 100, r.paid / 100]);

  const totals = list.reduce((acc, r) => ({
    count: acc.count + r.count, subtotal: acc.subtotal + r.subtotal,
    tax: acc.tax + r.tax, total: acc.total + r.total, paid: acc.paid + r.paid,
  }), { count: 0, subtotal: 0, tax: 0, total: 0, paid: 0 });

  const summary = el('div', { class: 'stat-row' },
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('total') }),
      el('div', { class: 'stat-value', text: money(totals.total) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('nav_invoices') }),
      el('div', { class: 'stat-value', text: String(totals.count) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('tax') }),
      el('div', { class: 'stat-value', text: money(totals.tax) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('amount_paid') }),
      el('div', { class: 'stat-value', text: money(totals.paid) })),
  );

  if (!list.length) return reportCard('rep_sales_summary', noRows(), summary);

  return reportCard('rep_sales_summary', dataTable({
    columns: [
      { key: 'month', label: 'Month', className: 'nowrap', sortable: false,
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

  lastHeader = ['Customer', 'Invoices', 'Total', 'Paid', 'Balance'];
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

  lastHeader = ['Code', 'Description', 'Qty', 'Times', 'Total'];
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

  lastHeader = ['Invoice', 'Date', 'Due', 'Customer', 'Total', 'Balance', 'Days'];
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

  lastHeader = ['Customer', ...AGING_BUCKETS.map((b) => T(b.key)), 'Total'];
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
      html: `Aged as of ${esc(fmtDate(asOf))}.` }));
}

// ===========================================================================
// Owing, and gone quiet
//
// Aged Receivables ages the invoice; this ages the silence. They are not the
// same question and can disagree completely: a customer can be ninety days
// overdue on one invoice and still have paid something last week, and another
// can owe on an invoice raised recently while not having paid a penny since
// spring. This one answers "who owes me money and has stopped paying" —
// including the customers who have never paid at all, who are easy to lose
// track of precisely because they have no payment history to notice.
// ===========================================================================

async function buildQuiet() {
  await ensureData(['invoices', 'payments']);
  // Silence is always counted back from today, never from the To date. The
  // range decides which unpaid invoices are in question; how long someone has
  // gone without paying is a fact about now. Tying it to To meant a range
  // ending next year made every customer look silent for a year.
  const months = Number(state.quietMonths) || 3;
  const asOf = today();
  const cutoff = addMonths(asOf, -months);

  // Group by customer id where there is one, by name where there is not, so a
  // customer imported without a link still gets counted rather than vanishing.
  const keyOf = (r) => r.customerId || r.customerName || '—';

  const byCustomer = new Map();
  for (const inv of invoices) {
    if (!live(inv) || (Number(inv.balanceCents) || 0) <= 0) continue;
    // The From/To range picks which unpaid invoices count. The silence is
    // still measured against every payment ever made, so a customer who paid
    // last month is not called silent just because the payment falls outside
    // the window being looked at.
    if (!inRange(inv.date || '')) continue;
    const key = keyOf(inv);
    const row = byCustomer.get(key) || {
      id: inv.customerId || '', name: inv.customerName || '—',
      balance: 0, openCount: 0, oldest: '', oldestNumber: '',
      lastPayDate: '', lastPayCents: 0,
    };
    row.balance += Number(inv.balanceCents) || 0;
    row.openCount += 1;
    if (inv.date && (!row.oldest || inv.date < row.oldest)) {
      row.oldest = inv.date;
      row.oldestNumber = inv.number || '';
    }
    byCustomer.set(key, row);
  }

  // The most recent real payment each of them made. A refund is money going
  // the other way, so it is not a sign of life for this purpose.
  for (const pay of payments) {
    if (pay.isRefund) continue;
    if ((Number(pay.amountCents) || 0) <= 0) continue;
    const date = pay.date || '';
    if (!date || date > asOf) continue;
    const row = byCustomer.get(keyOf(pay));
    if (!row) continue;
    if (date > row.lastPayDate) { row.lastPayDate = date; row.lastPayCents = Number(pay.amountCents) || 0; }
  }

  const list = [...byCustomer.values()]
    .filter((r) => !r.lastPayDate || r.lastPayDate < cutoff)
    .map((r) => ({ ...r, silentDays: r.lastPayDate ? daysBetween(r.lastPayDate, asOf) : null }))
    .sort((a, b) => b.balance - a.balance);

  const owed = list.reduce((s, r) => s + r.balance, 0);
  const neverPaid = list.filter((r) => !r.lastPayDate);
  const neverOwed = neverPaid.reduce((s, r) => s + r.balance, 0);

  lastHeader = [T('customer'), T('rep_open_invoices'), T('rep_oldest_unpaid'),
    T('rep_last_payment'), T('amount'), T('rep_silent_for'), T('balance_due')];
  lastRows = list.map((r) => [
    r.name, r.openCount, r.oldest,
    r.lastPayDate || T('rep_never_paid'),
    r.lastPayDate ? r.lastPayCents / 100 : '',
    r.silentDays === null ? '' : r.silentDays,
    r.balance / 100,
  ]);

  const summary = el('div', {},
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' + (list.length ? ' stat--warn' : '') },
        el('div', { class: 'stat-label', html: L('customer') }),
        el('div', { class: 'stat-value', text: String(list.length) })),
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L('balance_due') }),
        el('div', { class: 'stat-value', text: money(owed) })),
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L('rep_never_paid') }),
        el('div', { class: 'stat-value', text: `${neverPaid.length} · ${money(neverOwed)}` })),
    ),
    el('p', { class: 'text-small text-muted mb-1', html:
      `Customers with unpaid invoices dated <strong>${esc(fmtDate(state.from))}</strong> to `
      + `<strong>${esc(fmtDate(state.to))}</strong> whose last payment — on any invoice, at any time — was `
      + `before <strong>${esc(fmtDate(cutoff))}</strong>, or who have never paid at all. `
      + `Biggest balance first.` }),
  );

  if (!list.length) {
    return reportCard('rep_quiet', el('div', { class: 'empty' },
      el('p', { html: `Nobody owing has been silent for ${months} ${months === 1 ? 'month' : 'months'}.` })),
    summary, `As of ${fmtDate(asOf)} · no payment since ${fmtDate(cutoff)}`);
  }

  const silentText = (r) => {
    if (r.silentDays === null) return `<strong class="text-red">${T('rep_never_paid')}</strong>`;
    const m = Math.floor(r.silentDays / 30);
    return `<strong>${r.silentDays}</strong> <span class="cell-muted">days</span>`
      + (m >= 1 ? `<span class="cell-sub">about ${m} ${m === 1 ? 'month' : 'months'}</span>` : '');
  };

  const columns = [
    { key: 'name', labelKey: 'customer', sortable: false,
      html: (r) => (r.id
        ? `<a href="customer.html?id=${encodeURIComponent(r.id)}">${esc(r.name)}</a>`
        : esc(r.name)) },
    { key: 'openCount', labelKey: 'rep_open_invoices', className: 'num', sortable: false,
      html: (r) => String(r.openCount),
      footer: (l) => String(l.reduce((s, r) => s + r.openCount, 0)) },
    { key: 'oldest', labelKey: 'rep_oldest_unpaid', className: 'nowrap', sortable: false,
      html: (r) => `${esc(fmtDate(r.oldest))}`
        + (r.oldestNumber ? `<span class="cell-sub input-mono">${esc(r.oldestNumber)}</span>` : '') },
    { key: 'lastPayDate', labelKey: 'rep_last_payment', className: 'nowrap', sortable: false,
      html: (r) => (r.lastPayDate
        ? `${esc(fmtDate(r.lastPayDate))}<span class="cell-sub">${esc(money(r.lastPayCents))}</span>`
        : `<span class="cell-muted">—</span>`) },
    { key: 'silent', labelKey: 'rep_silent_for', className: 'nowrap', sortable: false,
      html: silentText },
    { key: 'balance', labelKey: 'balance_due', className: 'num', sortable: false,
      html: (r) => `<strong>${esc(money(r.balance))}</strong>`,
      footer: (l) => esc(money(l.reduce((s, r) => s + r.balance, 0))) },
  ];

  return reportCard('rep_quiet', dataTable({
    columns,
    rows: list,
    onRowClick: (r) => { if (r.id) location.href = `statements.html?customer=${encodeURIComponent(r.id)}`; },
  }), summary, `Invoices ${fmtDate(state.from)} — ${fmtDate(state.to)} · no payment since ${fmtDate(cutoff)}`);
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

  lastHeader = ['Payment', 'Date', 'Customer', 'Method', 'Reference', 'Amount'];
  lastRows = list.map((r) => [
    r.number, r.date, r.customerName, methodLabel(r.method), r.reference, (Number(r.amountCents) || 0) / 100,
  ]);

  const summary = el('div', { class: 'stat-row' },
    ...PAYMENT_METHODS
      .filter((m) => byMethod.get(m.value))
      .map((m) => el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L(m.key) }),
        el('div', { class: 'stat-value', text: money(byMethod.get(m.value)) }),
      )),
    el('div', { class: 'stat stat--good' },
      el('div', { class: 'stat-label', html: L('total') }),
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

  lastHeader = ['Month', 'Taxable', 'Exempt',
    settings.tax1Name || 'Tax 1', settings.tax2Name || 'Tax 2', 'Total'];
  lastRows = list.map((r) => [r.month, r.taxable / 100, r.exempt / 100, r.tax1 / 100, r.tax2 / 100, r.total / 100]);

  if (!list.length) return reportCard('rep_tax', noRows());

  const columns = [
    { key: 'month', label: 'Month', className: 'nowrap', sortable: false,
      html: (r) => esc(monthLabel(r.month)) },
    { key: 'taxable', label: `${T('line_taxable')} / ${T('item_taxable')}`, className: 'num', sortable: false,
      html: (r) => esc(money(r.taxable)), footer: (l) => esc(money(l.reduce((s, r) => s + r.taxable, 0))) },
    { key: 'exempt', label: `${T('cust_tax_exempt')}`, className: 'num cell-muted', sortable: false,
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

  lastHeader = ['Quote', 'Date', 'Customer', 'Total', 'Status'];
  lastRows = list.map((r) => [
    r.number, r.date, r.customerName, (Number(r.totalCents) || 0) / 100,
    T(statusKey(displayStatus(r, asOf))),
  ]);

  const summary = el('div', { class: 'stat-row' },
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('nav_quotes') }),
      el('div', { class: 'stat-value', text: String(list.length) })),
    el('div', { class: 'stat stat--good' },
      el('div', { class: 'stat-label', html: L('st_converted') }),
      el('div', { class: 'stat-value', text: `${rate}%` }),
      el('div', { class: 'stat-sub', text: `${counts.converted || 0} ${T('of')} ${list.length}` })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('total') }),
      el('div', { class: 'stat-value', text: money(totalValue) })),
    el('div', { class: 'stat' },
      el('div', { class: 'stat-label', html: L('st_accepted') }),
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
      [T(name.labelKey)],
      [`${T('date_from')} ${state.from}`, `${T('date_to')} ${state.to}`],
      [],
      lastHeader,
      ...lastRows,
    ]),
  );
}

onAction('print', () => window.print());
