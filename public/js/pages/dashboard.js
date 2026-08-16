import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, money, fmtDate,
  today, monthStart, monthEnd, loadAll, orderBy, where, limit, onAction,
  spinner,
} from '../app.js';
import {
  displayStatus,
} from '../model.js';
import {
  statusPill, dataTable, stat, card,
} from '../components.js';

setPageTitle('nav_home');
const { settings } = await initShell('dashboard.html');

const page = $('#page');

page.append(pageHeader('nav_home', [
  { key: 'act_new_invoice', variant: 'primary', accel: 'F2', onClick: () => { location.href = 'invoice.html?new=1'; } },
  { key: 'act_new_quote', accel: 'F3', onClick: () => { location.href = 'quote.html?new=1'; } },
  { key: 'act_new_payment', accel: 'F8', onClick: () => { location.href = 'payment.html?new=1'; } },
  { key: 'act_new_customer', onClick: () => { location.href = 'customer.html?new=1'; } },
], fmtDate(today())));

const body = el('div', {});
page.append(body);
body.append(spinner());

let recentInvoices = [];
let openInvoices = [];
let recentPayments = [];
let openQuotes = [];
let dueRecurring = [];

try {
  [recentInvoices, openInvoices, recentPayments, openQuotes, dueRecurring] = await Promise.all([
    loadAll('invoices', orderBy('date', 'desc'), limit(60)),
    loadAll('invoices', where('balanceCents', '>', 0), limit(1000)),
    loadAll('payments', orderBy('date', 'desc'), limit(12)),
    loadAll('quotes', where('status', '==', 'open'), limit(200)),
    loadAll('recurring', where('active', '==', true), limit(100)),
  ]);
} catch (err) {
  console.error('Dashboard load failed', err);
  body.innerHTML = '';
  body.append(el('div', { class: 'empty' },
    el('p', { html: 'Could not load the data.' }),
    el('p', { class: 'text-small text-muted', text: err.message || '' }),
  ));
  throw err;
}

const asOf = today();
const from = monthStart();
const to = monthEnd();

const live = (inv) => !inv.voided && inv.status !== 'draft';

const monthSales = recentInvoices
  .filter((i) => live(i) && i.date >= from && i.date <= to)
  .reduce((s, i) => s + (Number(i.totalCents) || 0), 0);

const monthCount = recentInvoices.filter((i) => live(i) && i.date >= from && i.date <= to).length;

const outstanding = openInvoices
  .filter(live)
  .reduce((s, i) => s + (Number(i.balanceCents) || 0), 0);

const overdueList = openInvoices.filter((i) => live(i) && displayStatus(i, asOf) === 'overdue');
const overdue = overdueList.reduce((s, i) => s + (Number(i.balanceCents) || 0), 0);

const quotesValue = openQuotes
  .filter((q) => !q.voided && !(q.expiryDate && q.expiryDate < asOf))
  .reduce((s, q) => s + (Number(q.totalCents) || 0), 0);

const recurringDue = dueRecurring.filter((r) => r.nextDate && r.nextDate <= asOf);

body.innerHTML = '';

body.append(el('div', { class: 'stat-row' },
  stat('dash_month_sales', money(monthSales), {
    sub: `${monthCount} ${T('nav_invoices').toLowerCase()}`,
  }),
  stat('dash_outstanding', money(outstanding), {
    sub: `${openInvoices.filter(live).length} ${T('nav_invoices').toLowerCase()}`,
  }),
  stat('dash_overdue', money(overdue), {
    tone: overdue > 0 ? 'warn' : undefined,
    sub: `${overdueList.length} ${T('nav_invoices').toLowerCase()}`,
  }),
  stat('dash_open_quotes', money(quotesValue), {
    sub: `${openQuotes.length} ${T('nav_quotes').toLowerCase()}`,
  }),
));

if (recurringDue.length) {
  body.append(el('div', { class: 'card' },
    el('div', { class: 'card-body', style: 'display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap' },
      el('div', {},
        el('strong', { html: L('rec_due') }),
        el('div', { class: 'text-small text-muted',
          text: recurringDue.map((r) => `${r.customerName} — ${fmtDate(r.nextDate)}`).slice(0, 4).join(' · ') }),
      ),
      el('a', { class: 'btn btn-primary', href: 'recurring.html', html: L('rec_generate_now') }),
    ),
  ));
}

const twoCol = el('div', { class: 'two-col' });

// ---- Recent invoices ----
twoCol.append(card('dash_recent_invoices',
  dataTable({
    columns: [
      { key: 'number', labelKey: 'number', className: 'nowrap', sortable: false,
        html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false,
        html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', sortable: false,
        html: (r) => esc(r.customerName || '—') },
      { key: 'totalCents', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => esc(money(r.totalCents)) },
      { key: 'status', labelKey: 'status', className: 'nowrap', sortable: false,
        html: (r) => statusPill(r, asOf) },
    ],
    rows: recentInvoices.slice(0, 10),
    onRowClick: (r) => { location.href = `invoice.html?id=${encodeURIComponent(r.id)}`; },
    rowClass: (r) => (r.voided ? 'is-void' : ''),
  }),
  {
    flush: true,
    headExtra: el('a', { class: 'btn btn-ghost btn-sm', href: 'invoices.html', html: L('all') }),
  },
));

// ---- Recent payments ----
twoCol.append(card('dash_recent_payments',
  dataTable({
    columns: [
      { key: 'number', labelKey: 'number', className: 'nowrap', sortable: false,
        html: (r) => `<span class="input-mono">${esc(r.number || '—')}</span>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false,
        html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', sortable: false,
        html: (r) => esc(r.customerName || '—') },
      { key: 'amountCents', labelKey: 'amount', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.amountCents))}</strong>` },
    ],
    rows: recentPayments.slice(0, 10),
    onRowClick: (r) => { location.href = `payment.html?id=${encodeURIComponent(r.id)}`; },
  }),
  {
    flush: true,
    headExtra: el('a', { class: 'btn btn-ghost btn-sm', href: 'payments.html', html: L('all') }),
  },
));

body.append(twoCol);

// ---- Overdue, when there is any ----
if (overdueList.length) {
  const sorted = [...overdueList].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  body.append(card('dash_overdue',
    dataTable({
      columns: [
        { key: 'number', labelKey: 'invoice_number', className: 'nowrap', sortable: false,
          html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
        { key: 'customerName', labelKey: 'customer', sortable: false,
          html: (r) => esc(r.customerName || '—') },
        { key: 'dueDate', labelKey: 'due_date', className: 'nowrap', sortable: false,
          html: (r) => esc(fmtDate(r.dueDate)) },
        { key: 'balanceCents', labelKey: 'balance_due', className: 'num', sortable: false,
          html: (r) => `<strong>${esc(money(r.balanceCents))}</strong>`,
          footer: (list) => esc(money(list.reduce((s, r) => s + (Number(r.balanceCents) || 0), 0))) },
      ],
      rows: sorted.slice(0, 15),
      onRowClick: (r) => { location.href = `invoice.html?id=${encodeURIComponent(r.id)}`; },
    }),
    {
      flush: true,
      headExtra: el('a', { class: 'btn btn-ghost btn-sm', href: 'reports.html?report=aged', html: L('rep_aged') }),
    },
  ));
}

if (!recentInvoices.length) {
  body.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
    el('div', { class: 'empty' },
      el('p', { html: '<strong>No invoices yet.</strong>' }),
      el('p', { class: 'text-small', html:
        'Coming from Express Invoice? Start by importing your history.' }),
      el('div', { class: 'quick-actions', style: 'justify-content:center' },
        el('a', { class: 'btn btn-primary', href: 'import.html', html: L('nav_import') }),
        el('a', { class: 'btn btn-default', href: 'settings.html', html: L('nav_settings') }),
      ),
    ),
  )));
}

onAction('new', () => { location.href = 'invoice.html?new=1'; });
